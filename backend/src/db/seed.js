import { pool } from './pool.js';
import { withTransaction } from './tx.js';
import { passwords } from '../auth/passwords.js';

const password = process.env.SEED_PASSWORD;
if (!password || password.length < 8) {
  throw new Error('set SEED_PASSWORD (8 characters minimum) to seed the database');
}

const USERS = [
  { key: 'alice', email: 'alice@musicroom.test', displayName: 'Alice', genres: ['Pop', 'Electro'] },
  { key: 'bob', email: 'bob@musicroom.test', displayName: 'Bob', genres: ['Rock', 'Metal'] },
  { key: 'chloe', email: 'chloe@musicroom.test', displayName: 'Chloe', genres: ['Jazz', 'Soul'] },
  {
    key: 'david',
    email: 'david@musicroom.test',
    displayName: 'David',
    genres: ['Hip-hop', 'Reggae'],
  },
];

const GENRES = [
  'Pop',
  'Rock',
  'Electro',
  'Hip-hop',
  'Jazz',
  'Classical',
  'Soul',
  'Reggae',
  'Metal',
  'Funk',
];

const TRACKS = [
  { key: 'one-more-time', artist: 'Daft Punk', title: 'One More Time' },
  { key: 'get-lucky', artist: 'Daft Punk', title: 'Get Lucky' },
  { key: 'levitating', artist: 'Dua Lipa', title: 'Levitating' },
  { key: 'blinding-lights', artist: 'The Weeknd', title: 'Blinding Lights' },
  { key: 'bad-guy', artist: 'Billie Eilish', title: 'bad guy' },
  { key: 'strobe', artist: 'deadmau5', title: 'Strobe' },
  { key: 'midnight-city', artist: 'M83', title: 'Midnight City' },
  { key: 'mr-brightside', artist: 'The Killers', title: 'Mr. Brightside' },
  { key: 'seven-nation-army', artist: 'The White Stripes', title: 'Seven Nation Army' },
  { key: 'smells-like-teen-spirit', artist: 'Nirvana', title: 'Smells Like Teen Spirit' },
  { key: 'enter-sandman', artist: 'Metallica', title: 'Enter Sandman' },
  { key: 'take-five', artist: 'Dave Brubeck', title: 'Take Five' },
  { key: 'so-what', artist: 'Miles Davis', title: 'So What' },
  { key: 'ain-t-no-sunshine', artist: 'Bill Withers', title: "Ain't No Sunshine" },
  { key: 'superstition', artist: 'Stevie Wonder', title: 'Superstition' },
  { key: 'get-up', artist: 'James Brown', title: 'Get Up (I Feel Like Being A) Sex Machine' },
  { key: 'is-this-love', artist: 'Bob Marley & The Wailers', title: 'Is This Love' },
  { key: 'lose-yourself', artist: 'Eminem', title: 'Lose Yourself' },
  { key: 'humble', artist: 'Kendrick Lamar', title: 'HUMBLE.' },
  { key: 'clair-de-lune', artist: 'Claude Debussy', title: 'Clair de lune' },
];

const ROOMS = [
  {
    name: 'Electro night',
    description: 'Open to everyone: vote for the next track',
    owner: 'alice',
    visibility: 'public',
    accessPolicy: 'everyone',
    members: [],
    queue: [
      { track: 'one-more-time', addedBy: 'alice', votes: ['bob', 'chloe', 'david'] },
      { track: 'strobe', addedBy: 'bob', votes: ['alice', 'chloe'] },
      { track: 'midnight-city', addedBy: 'chloe', votes: ['david'] },
      { track: 'get-lucky', addedBy: 'david', votes: [] },
      { track: 'levitating', addedBy: 'alice', votes: [] },
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
      { track: 'seven-nation-army', addedBy: 'bob', votes: ['alice', 'david'] },
      { track: 'superstition', addedBy: 'alice', votes: ['bob'] },
      { track: 'lose-yourself', addedBy: 'david', votes: [] },
    ],
  },
];

// Deezer search returns the best match first; the seed stores real ids so playback works.
async function lookupDeezer({ artist, title }) {
  const q = `artist:"${artist}" track:"${title}"`;
  const res = await fetch(`https://api.deezer.com/search?limit=1&q=${encodeURIComponent(q)}`);
  if (!res.ok)
    throw new Error(`Deezer search failed (HTTP ${res.status}) for ${artist} - ${title}`);
  const body = await res.json();
  const hit = body.data?.[0];
  if (!hit) throw new Error(`no Deezer result for ${artist} - ${title}`);
  return {
    providerTrackId: String(hit.id),
    title: hit.title,
    artist: hit.artist.name,
    durationMs: hit.duration * 1000,
    coverUrl: hit.album?.cover_medium ?? null,
  };
}

const emails = USERS.map((u) => u.email);
const [existing] = await pool.query('SELECT email FROM users WHERE email IN (?)', [emails]);
if (existing.length > 0) {
  console.log('seed already applied, nothing to do');
  await pool.end();
  process.exit(0);
}

// network calls and hashing stay outside the transaction (it may be replayed)
const deezer = [];
for (const t of TRACKS) deezer.push({ key: t.key, ...(await lookupDeezer(t)) });
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

  await conn.query('INSERT IGNORE INTO genres (name) VALUES ?', [GENRES.map((g) => [g])]);
  const [genreRows] = await conn.query('SELECT id, name FROM genres WHERE name IN (?)', [GENRES]);
  const genreIds = Object.fromEntries(genreRows.map((g) => [g.name, g.id]));

  const userGenres = USERS.flatMap((u) => u.genres.map((g) => [userIds[u.key], genreIds[g]]));
  await conn.query('INSERT INTO user_genres (user_id, genre_id) VALUES ?', [userGenres]);

  await conn.query(
    `INSERT IGNORE INTO tracks (provider, provider_track_id, title, artist, duration_ms, cover_url)
     VALUES ?`,
    [deezer.map((t) => ['deezer', t.providerTrackId, t.title, t.artist, t.durationMs, t.coverUrl])],
  );
  const [trackRows] = await conn.query(
    "SELECT id, provider_track_id FROM tracks WHERE provider = 'deezer' AND provider_track_id IN (?)",
    [deezer.map((t) => t.providerTrackId)],
  );
  const idByProviderId = Object.fromEntries(trackRows.map((t) => [t.provider_track_id, t.id]));
  const trackIds = Object.fromEntries(
    deezer.map((t) => [t.key, idByProviderId[t.providerTrackId]]),
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
  `seeded ${USERS.length} users, ${GENRES.length} genres, ${TRACKS.length} tracks, ${ROOMS.length} rooms`,
);
await pool.end();
