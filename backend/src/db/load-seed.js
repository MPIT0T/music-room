// Load test data: users, rooms and access tokens, printed as JSON on stdout for k6.
// Only touches rows it owns (emails @load.test, tracks load-*), so it can run on any stack.
import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { withTransaction } from './tx.js';
import { createTokenService, ACCESS_TOKEN_TTL_SECONDS } from '../auth/tokens.js';

const USERS = Number(process.env.LOAD_USERS ?? 200);
const ROOMS = Number(process.env.LOAD_ROOMS ?? 10);
const TRACKS_PER_ROOM = 5;
const EMAIL_DOMAIN = 'load.test';
const TRACK_PREFIX = 'load-';

if (!Number.isInteger(USERS) || USERS < 1 || !Number.isInteger(ROOMS) || ROOMS < 1) {
  throw new Error('LOAD_USERS and LOAD_ROOMS must be positive integers');
}

const tokens = createTokenService();

// Every id is drawn here, outside the transaction: withTransaction may replay it
const users = Array.from({ length: USERS }, (_, i) => ({
  id: randomUUID(),
  deviceId: randomUUID(),
  email: `load-${i}@${EMAIL_DOMAIN}`,
  displayName: `Load ${i}`,
}));
// One public room per owner, owners are the first ROOMS users
const rooms = Array.from({ length: ROOMS }, (_, i) => ({
  id: randomUUID(),
  ownerId: users[i % USERS].id,
  name: `Load room ${i}`,
  roomTrackIds: Array.from({ length: TRACKS_PER_ROOM }, () => randomUUID()),
}));
// Fake catalog: Jamendo is never called during a load test
const trackIds = Array.from({ length: TRACKS_PER_ROOM }, () => randomUUID());

await withTransaction(pool, async (conn) => {
  // Previous run first: rooms.owner_id is RESTRICT, and room_tracks.track_id has no cascade
  await conn.query(
    'DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE ?)',
    [`%@${EMAIL_DOMAIN}`],
  );
  await conn.query('DELETE FROM users WHERE email LIKE ?', [`%@${EMAIL_DOMAIN}`]);
  await conn.query("DELETE FROM tracks WHERE provider = 'jamendo' AND provider_track_id LIKE ?", [
    `${TRACK_PREFIX}%`,
  ]);

  // No password: the load test never logs in (argon2 and the signup limit would skew it)
  await conn.query('INSERT INTO users (id, email, email_verified_at, display_name) VALUES ?', [
    users.map((u) => [u.id, u.email, new Date(), u.displayName]),
  ]);
  await conn.query('INSERT INTO devices (id, user_id, name, platform) VALUES ?', [
    users.map((u) => [u.deviceId, u.id, 'k6', 'android']),
  ]);

  await conn.query(
    'INSERT INTO tracks (id, provider, provider_track_id, title, artist, duration_ms) VALUES ?',
    [trackIds.map((id, i) => [id, 'jamendo', `${TRACK_PREFIX}${i}`, `Track ${i}`, 'k6', 180000])],
  );

  await conn.query('INSERT INTO rooms (id, owner_id, name, visibility, access_policy) VALUES ?', [
    rooms.map((r) => [r.id, r.ownerId, r.name, 'public', 'everyone']),
  ]);
  const roomTracks = rooms.flatMap((r) =>
    r.roomTrackIds.map((id, i) => [id, r.id, trackIds[i], r.ownerId]),
  );
  await conn.query('INSERT INTO room_tracks (id, room_id, track_id, added_by) VALUES ?', [
    roomTracks,
  ]);
});

// Signed after the commit: no token is printed for users that failed to insert
const out = {
  expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
  rooms: rooms.map(({ id, roomTrackIds }) => ({ id, roomTrackIds })),
  users: await Promise.all(
    users.map(async (u, i) => ({
      id: u.id,
      roomId: rooms[i % ROOMS].id,
      token: await tokens.signAccessToken({ userId: u.id, deviceId: u.deviceId }),
    })),
  ),
};

// stdout carries the JSON only, the summary goes to stderr
process.stdout.write(JSON.stringify(out));
console.error(`load data: ${USERS} users, ${ROOMS} rooms, tokens valid until ${out.expiresAt}`);
await pool.end();
