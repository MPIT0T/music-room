import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { withTransaction } from '../src/db/tx.js';
import { openSession } from '../src/auth/sessions.js';

// Integration tests: real MariaDB (make test). Sessions are opened directly, not through
// the login route: no argon2 cost and no login rate limit in the way.
const RUN = randomUUID().slice(0, 8);
const DEVICE = { name: 'Pixel de Max', platform: 'android', model: 'Pixel 7', appVersion: '1.2.0' };
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const logChunks = [];
const stream = new Writable({
  write(chunk, _enc, done) {
    logChunks.push(chunk.toString());
    done();
  },
});
const logLines = () =>
  logChunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// Records which socket rooms were closed; the real io only exists in server.js
const closedRooms = [];
const fakeIo = {
  in: (room) => ({ disconnectSockets: (close) => closedRooms.push({ room, close }) }),
};

let app;
let user;
const secrets = [];

before(async () => {
  app = await buildApp({ logger: loggerOptions({ stream }) });
  app.decorate('io', fakeIo);
  const [[row]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES (?, 'not-a-real-hash', NOW(3), 'max') RETURNING id`,
    [`refresh-${RUN}@example.com`],
  );
  user = { id: row.id, email: `refresh-${RUN}@example.com` };
});
beforeEach(() => {
  closedRooms.length = 0;
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`refresh-${RUN}%`]);
  await app.close();
});

async function newSession() {
  const session = await withTransaction(app.db, (conn) =>
    openSession(conn, app.tokens, { userId: user.id, device: DEVICE }),
  );
  secrets.push(session.accessToken, session.refreshToken);
  return session;
}

async function refresh(refreshToken) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sessions/refresh',
    payload: { refreshToken },
  });
  if (res.statusCode === 200) secrets.push(res.json().accessToken, res.json().refreshToken);
  return res;
}

const logout = (accessToken) =>
  app.inject({
    method: 'DELETE',
    url: '/v1/sessions/current',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });

async function deviceRow(id) {
  const [[row]] = await app.db.query(
    `SELECT refresh_hash, previous_refresh_hash, refresh_expires_at, rotated_at FROM devices WHERE id = ?`,
    [id],
  );
  return row;
}

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('refresh rotates the token and returns a new session for the same device', async () => {
  const first = await newSession();

  const res = await refresh(first.refreshToken);

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.notEqual(body.refreshToken, first.refreshToken);
  assert.match(body.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.deviceId, first.deviceId);
  assert.equal(body.refreshTokenExpiresIn, 30 * 24 * 60 * 60);
  assert.deepEqual(await app.tokens.verifyAccessToken(body.accessToken), {
    userId: user.id,
    deviceId: first.deviceId,
  });
  assert.deepEqual(body.user, {
    id: user.id,
    email: user.email,
    emailVerified: true,
    displayName: 'max',
    avatarUrl: null,
    plan: 'free',
    providers: ['password'],
  });

  const row = await deviceRow(first.deviceId);
  assert.equal(row.refresh_hash, sha256(body.refreshToken));
  assert.equal(row.previous_refresh_hash, sha256(first.refreshToken));
  assert.ok(row.rotated_at instanceof Date);
});

test('the new refresh token can itself be rotated', async () => {
  const first = await newSession();
  const second = (await refresh(first.refreshToken)).json();

  const res = await refresh(second.refreshToken);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().deviceId, first.deviceId);
});

test('two concurrent refreshes with the same token: one 200, one 409, no revocation', async () => {
  const { refreshToken, deviceId } = await newSession();

  const results = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);

  const winner = results.find((r) => r.statusCode === 200);
  const loser = results.find((r) => r.statusCode !== 200);
  assert.ok(winner, 'no refresh succeeded');
  assertProblem(loser, 409, 'refresh_conflict');
  // The winner's token still works: the conflict did not revoke the device
  assert.equal((await refresh(winner.json().refreshToken)).statusCode, 200);
  assert.equal(closedRooms.length, 0);
  assert.ok((await deviceRow(deviceId)).refresh_hash);
});

test('replaying an old token after the grace window revokes the device session', async () => {
  const first = await newSession();
  const second = (await refresh(first.refreshToken)).json();
  // Pretend the rotation happened 11 s ago
  await app.db.query('UPDATE devices SET rotated_at = NOW(3) - INTERVAL 11 SECOND WHERE id = ?', [
    first.deviceId,
  ]);

  const res = await refresh(first.refreshToken);

  assertProblem(res, 401, 'refresh_token_reused');
  assert.deepEqual(await deviceRow(first.deviceId), {
    refresh_hash: null,
    previous_refresh_hash: null,
    refresh_expires_at: null,
    rotated_at: null,
  });
  // The thief may hold the latest token: it is dead too
  assertProblem(await refresh(second.refreshToken), 401, 'invalid_refresh_token');
  assert.deepEqual(closedRooms, [{ room: `device:${first.deviceId}`, close: true }]);

  const warn = logLines().find((l) => l.msg === 'refresh token reused, device session revoked');
  assert.ok(warn, 'no warning logged');
  assert.equal(warn.level, 40);
  assert.equal(warn.deviceId, first.deviceId);
  assert.equal(warn.userId, user.id);
});

test('an unknown refresh token gives 401 invalid_refresh_token', async () => {
  const res = await refresh(randomBytes(32).toString('base64url'));

  assertProblem(res, 401, 'invalid_refresh_token');
});

test('an expired refresh token gives 401 invalid_refresh_token', async () => {
  const { refreshToken, deviceId } = await newSession();
  await app.db.query(
    'UPDATE devices SET refresh_expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?',
    [deviceId],
  );

  assertProblem(await refresh(refreshToken), 401, 'invalid_refresh_token');
});

test('a malformed refresh token is rejected before the database', async () => {
  for (const refreshToken of ['abc', 'a'.repeat(44), 'a'.repeat(42) + '=', undefined, 42]) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/refresh',
      payload: { refreshToken },
    });
    assert.equal(res.statusCode, 400, `accepted ${refreshToken}`);
  }
});

test('logout revokes this device only, keeps its row and closes its sockets', async () => {
  const phone = await newSession();
  const laptop = await newSession();

  const res = await logout(phone.accessToken);

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
  const row = await deviceRow(phone.deviceId);
  assert.ok(row, 'the devices row was deleted');
  assert.equal(row.refresh_hash, null);
  assertProblem(await refresh(phone.refreshToken), 401, 'invalid_refresh_token');
  assert.deepEqual(closedRooms, [{ room: `device:${phone.deviceId}`, close: true }]);
  assert.equal((await refresh(laptop.refreshToken)).statusCode, 200);
});

test('logout needs an access token and can be repeated', async () => {
  const { accessToken } = await newSession();

  assert.equal((await logout()).statusCode, 401);
  assert.equal((await logout(accessToken)).statusCode, 204);
  assert.equal((await logout(accessToken)).statusCode, 204);
});

test('no access or refresh token ever reaches the logs', async () => {
  assert.ok(secrets.length > 10);
  const output = logChunks.join('');
  for (const secret of secrets) {
    assert.ok(!output.includes(secret), 'a token reached the logs');
    assert.ok(!output.includes(sha256(secret)), 'a token hash reached the logs');
  }
});

test('refresh and logout are documented with their answers', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  const refreshDoc = spec.paths['/v1/sessions/refresh']?.post;
  for (const status of ['200', '401', '409']) assert.ok(status in refreshDoc.responses, status);
  const logoutDoc = spec.paths['/v1/sessions/current']?.delete;
  for (const status of ['204', '401']) assert.ok(status in logoutDoc.responses, status);
  assert.deepEqual(logoutDoc.security, [{ bearerAuth: [] }]);
});
