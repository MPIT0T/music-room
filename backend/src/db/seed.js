import { setTimeout as sleep } from 'node:timers/promises';
import { pool } from './pool.js';
import { withTransaction } from './tx.js';
import { passwords } from '../auth/passwords.js';

const password = process.env.SEED_PASSWORD;
if (!password || password.length < 8) {
  throw new Error('set SEED_PASSWORD (8 characters minimum) to seed the database');
}

const clientId = process.env.JAMENDO_CLIENT_ID;
if (!clientId) {
  throw new Error('set JAMENDO_CLIENT_ID (free, from devportal.jamendo.com) to seed the database');
}

const USERS = [
  {
    key: 'alice',
    email: 'alice@musicroom.test',
    displayName: 'Alice',
    genres: ['Pop', 'Electronic'],
  },
  { key: 'bob', email: 'bob@musicroom.test', displayName: 'Bob', genres: ['Rock', 'Metal'] },
  {
    key: 'chloe',
    email: 'chloe@musicroom.test',
    displayName: 'Chloe',
    genres: ['Jazz', 'Classical'],
  },
  {
    key: 'david',
    email: 'david@musicroom.test',
    displayName: 'David',
    genres: ['Hip-hop', 'Reggae'],
  },
];

// name stored in the genres table, tag used to query Jamendo
const GENRES = [
  { name: 'Pop', tag: 'pop' },
  { name: 'Rock', tag: 'rock' },
  { name: 'Electronic', tag: 'electronic' },
  { name: 'Hip-hop', tag: 'hiphop' },
  { name: 'Jazz', tag: 'jazz' },
  { name: 'Classical', tag: 'classical' },
  { name: 'Reggae', tag: 'reggae' },
  { name: 'Metal', tag: 'metal' },
  { name: 'Folk', tag: 'folk' },
  { name: 'Ambient', tag: 'ambient' },
];

// most popular tracks of each genre, referenced below as `${tag}-${rank}`
const TRACKS_PER_GENRE = 2;

const ROOMS = [
  {
    name: 'Electro night',
    description: 'Open to everyone: vote for the next track',
    owner: 'alice',
    visibility: 'public',
    accessPolicy: 'everyone',
    members: [],
    queue: [
      { track: 'electronic-0', addedBy: 'alice', votes: ['bob', 'chloe', 'david'] },
      { track: 'electronic-1', addedBy: 'bob', votes: ['alice', 'chloe'] },
      { track: 'pop-0', addedBy: 'chloe', votes: ['david'] },
      { track: 'hiphop-0', addedBy: 'david', votes: [] },
      { track: 'ambient-0', addedBy: 'alice', votes: [] },
    ],
  },
  {
    name: 'Friday afterwork',
    description: 'Private room, invited friends only',
    owner: 'bob',
    visibility: 'private',
    accessPolicy: 'invited',
    members: ['alice', 'david'],
    queue: [
      { track: 'rock-0', addedBy: 'bob', votes: ['alice', 'david'] },
      { track: 'jazz-0', addedBy: 'alice', votes: ['bob'] },
      { track: 'metal-0', addedBy: 'david', votes: [] },
    ],
  },
];

// Jamendo answers HTTP 200 even on errors: the real status is in body.headers
async function fetchJamendoTracks(tag) {
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: String(TRACKS_PER_GENRE),
    tags: tag,
    order: 'popularity_total',
  });
  const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`);
  if (!res.ok) throw new Error(`Jamendo request failed (HTTP ${res.status}) for tag ${tag}`);
  const body = await res.json();
  if (body.headers?.status !== 'success') {
    throw new Error(`Jamendo error for tag ${tag}: ${body.headers?.error_message}`);
  }
  return body;
}

// Jamendo sometimes answers "success" with 0 results for a tag that has tracks: retry a few times
async function topJamendoTracks(tag, attempts = 4) {
  let body;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    body = await fetchJamendoTracks(tag);
    if (body.results.length >= TRACKS_PER_GENRE) break;
    if (attempt === attempts) {
      throw new Error(
        `not enough Jamendo tracks for tag ${tag} after ${attempts} tries: ${JSON.stringify(body.headers)}`,
      );
    }
    await sleep(1000 * attempt);
  }
  return body.results.map((t, rank) => ({
    key: `${tag}-${rank}`,
    providerTrackId: String(t.id),
    title: t.name,
    artist: t.artist_name,
    durationMs: t.duration * 1000,
    coverUrl: t.image || null,
  }));
}

const emails = USERS.map((u) => u.email);
const [existing] = await pool.query('SELECT email FROM users WHERE email IN (?)', [emails]);
if (existing.length > 0) {
  console.log('seed already applied, nothing to do');
  await pool.end();
  process.exit(0);
}

// network calls and hashing stay outside the transaction (it may be replayed)
const tracks = [];
for (const g of GENRES) tracks.push(...(await topJamendoTracks(g.tag)));
const hashes = await Promise.all(USERS.map(() => passwords.hash(password)));

await withTransaction(pool, async (conn) => {
  const userIds = {};
  for (const [i, u] of USERS.entries()) {
    const [[row]] = await conn.query(
      `INSERT INTO users (email, password_hash, email_verified_at, display_name)
       VALUES (?, ?, CURRENT_TIMESTAMP(3), ?) RETURNING id`,
      [u.email, hashes[i], u.displayName],
    );
    userIds[u.key] = row.id;
  }

  const genreNames = GENRES.map((g) => g.name);
  await conn.query('INSERT IGNORE INTO genres (name) VALUES ?', [genreNames.map((n) => [n])]);
  const [genreRows] = await conn.query('SELECT id, name FROM genres WHERE name IN (?)', [
    genreNames,
  ]);
  const genreIds = Object.fromEntries(genreRows.map((g) => [g.name, g.id]));

  const userGenres = USERS.flatMap((u) => u.genres.map((g) => [userIds[u.key], genreIds[g]]));
  await conn.query('INSERT INTO user_genres (user_id, genre_id) VALUES ?', [userGenres]);

  await conn.query(
    `INSERT IGNORE INTO tracks (provider, provider_track_id, title, artist, duration_ms, cover_url)
     VALUES ?`,
    [
      tracks.map((t) => [
        'jamendo',
        t.providerTrackId,
        t.title,
        t.artist,
        t.durationMs,
        t.coverUrl,
      ]),
    ],
  );
  const [trackRows] = await conn.query(
    "SELECT id, provider_track_id FROM tracks WHERE provider = 'jamendo' AND provider_track_id IN (?)",
    [tracks.map((t) => t.providerTrackId)],
  );
  const idByProviderId = Object.fromEntries(trackRows.map((t) => [t.provider_track_id, t.id]));
  const trackIds = Object.fromEntries(
    tracks.map((t) => [t.key, idByProviderId[t.providerTrackId]]),
  );

  for (const room of ROOMS) {
    const [[{ id: roomId }]] = await conn.query(
      `INSERT INTO rooms (owner_id, name, description, visibility, access_policy)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [userIds[room.owner], room.name, room.description, room.visibility, room.accessPolicy],
    );

    for (const member of room.members) {
      await conn.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
        roomId,
        userIds[member],
      ]);
    }

    for (const entry of room.queue) {
      const [[{ id: roomTrackId }]] = await conn.query(
        'INSERT INTO room_tracks (room_id, track_id, added_by) VALUES (?, ?, ?) RETURNING id',
        [roomId, trackIds[entry.track], userIds[entry.addedBy]],
      );
      for (const voter of entry.votes) {
        await conn.query('INSERT INTO votes (room_track_id, user_id) VALUES (?, ?)', [
          roomTrackId,
          userIds[voter],
        ]);
      }
    }
  }
});

console.log(
  `seeded ${USERS.length} users, ${GENRES.length} genres, ${tracks.length} tracks, ${ROOMS.length} rooms`,
);
await pool.end();
