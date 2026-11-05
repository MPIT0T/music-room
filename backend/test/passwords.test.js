import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { withTransaction } from '../src/db/tx.js';
import { openSession } from '../src/auth/sessions.js';
import { passwords } from '../src/auth/passwords.js';

// Integration tests: real MariaDB and Redis (make test). Accounts are created directly in the DB.
const RUN = randomUUID().slice(0, 8);
const email = (name) => `pwd-${RUN}-${name}@example.com`;
const OLD = 'correct horse battery';
const NEW = 'another long passphrase';
const DEVICE = { name: 'Pixel de Max', platform: 'android' };

const mailer = {
  sent: [],
  async sendPasswordReset(to, { token }) {
    this.sent.push({ to, token });
  },
};

// Unique rule names per run, real values from the contract
const limits = {
  login: { name: `login-${RUN}`, limit: 5, windowSeconds: 900 },
  loginIp: { name: `login-ip-${RUN}`, limit: 50, windowSeconds: 900 },
  passwordReset: { name: `reset-${RUN}`, limit: 3, windowSeconds: 3600 },
  changePassword: { name: `change-${RUN}`, limit: 5, windowSeconds: 900 },
};

const closedRooms = [];
const fakeIo = {
  in: (room) => ({ disconnectSockets: (close) => closedRooms.push({ room, close }) }),
};

const logChunks = [];
const stream = new Writable({
  write(chunk, _enc, done) {
    logChunks.push(chunk.toString());
    done();
  },
});

let app;
const secrets = [OLD, NEW];

before(async () => {
  app = await buildApp({ mailer, limits, logger: loggerOptions({ stream }) });
  app.decorate('io', fakeIo);
});
beforeEach(() => {
  mailer.sent.length = 0;
  closedRooms.length = 0;
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`pwd-${RUN}-%`]);
  const keys = await app.redis.keys(`rl:*-${RUN}:*`);
  if (keys.length) await app.redis.del(keys);
  await app.close();
});

async function createAccount(name, { verified = true, withPassword = true } = {}) {
  const [[row]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES (?, ?, IF(?, NOW(3), NULL), ?) RETURNING id`,
    [email(name), withPassword ? await passwords.hash(OLD) : null, verified, name],
  );
  return row.id;
}

async function newSession(userId) {
  const session = await withTransaction(app.db, (conn) =>
    openSession(conn, app.tokens, { userId, device: DEVICE }),
  );
  secrets.push(session.accessToken, session.refreshToken);
  return session;
}

const post = (url, payload) => app.inject({ method: 'POST', url, payload });
const askReset = (address) => post('/v1/password-resets', { email: address });
const confirm = (token, newPassword = NEW) =>
  post('/v1/password-resets/confirm', { token, newPassword });
const refresh = (refreshToken) => post('/v1/sessions/refresh', { refreshToken });
const login = (address, password) =>
  post('/v1/sessions', { email: address, password, device: DEVICE });
const change = (accessToken, body) =>
  app.inject({
    method: 'PUT',
    url: '/v1/me/password',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    payload: body,
  });

async function resetToken(address) {
  await askReset(address);
  const { token } = mailer.sent.at(-1);
  secrets.push(token);
  return token;
}

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('a reset request answers 202 the same way for known, unknown and Google-only accounts', async () => {
  await createAccount('known');
  await createAccount('google', { withPassword: false });

  const answers = [];
  for (const address of [email('known'), email('nobody'), email('google')]) {
    const res = await askReset(address);
    answers.push([res.statusCode, res.body]);
  }

  assert.deepEqual(answers, [
    [202, ''],
    [202, ''],
    [202, ''],
  ]);
  // Only real accounts get an email; a Google-only account can set its first password this way
  assert.deepEqual(
    mailer.sent.map((m) => m.to),
    [email('known'), email('google')],
  );
});

test('the 4th request in an hour is limited, for an unknown email too', async () => {
  for (const address of [email('limited'), email('ghost')]) {
    for (let i = 0; i < 3; i++) assert.equal((await askReset(address)).statusCode, 202);
    const res = await askReset(address);
    assertProblem(res, 429, 'rate_limited');
    assert.ok(Number(res.headers['retry-after']) > 0);
  }
});

test('confirm changes the password, signs out every device and verifies the email', async () => {
  const id = await createAccount('forgot', { verified: false });
  const phone = await newSession(id);
  const laptop = await newSession(id);
  const token = await resetToken(email('forgot'));

  const res = await confirm(token);

  assert.equal(res.statusCode, 204);
  assert.equal((await login(email('forgot'), NEW)).statusCode, 200);
  assertProblem(await login(email('forgot'), OLD), 401, 'invalid_credentials');
  assertProblem(await refresh(phone.refreshToken), 401, 'invalid_refresh_token');
  assertProblem(await refresh(laptop.refreshToken), 401, 'invalid_refresh_token');
  assert.deepEqual(closedRooms, [{ room: `user:${id}`, close: true }]);
  const [[row]] = await app.db.query('SELECT email_verified_at FROM users WHERE id = ?', [id]);
  assert.ok(row.email_verified_at instanceof Date);
});

test('a reset link works once, and a newer link revokes the older one', async () => {
  await createAccount('twice');
  const first = await resetToken(email('twice'));
  const second = await resetToken(email('twice'));

  assertProblem(await confirm(first), 400, 'invalid_token');
  assert.equal((await confirm(second)).statusCode, 204);
  assertProblem(await confirm(second), 400, 'invalid_token');
});

test('an expired, unknown or malformed token is refused', async () => {
  const id = await createAccount('expired');
  const token = await resetToken(email('expired'));
  await app.db.query(
    "UPDATE email_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE user_id = ? AND type = 'reset_password'",
    [id],
  );

  assertProblem(await confirm(token), 400, 'invalid_token');
  assertProblem(await confirm(randomBytes(32).toString('base64url')), 400, 'invalid_token');
  assertProblem(await confirm('not-a-token'), 400, 'validation_failed');
});

test('a too short new password is refused and the token stays usable', async () => {
  await createAccount('short');
  const token = await resetToken(email('short'));

  assertProblem(await confirm(token, 'short'), 400, 'validation_failed');
  assert.equal((await confirm(token)).statusCode, 204);
});

test('changing the password signs out the other devices only', async () => {
  const id = await createAccount('change');
  const current = await newSession(id);
  const other = await newSession(id);

  const res = await change(current.accessToken, { currentPassword: OLD, newPassword: NEW });

  assert.equal(res.statusCode, 204);
  assert.equal((await refresh(current.refreshToken)).statusCode, 200);
  assertProblem(await refresh(other.refreshToken), 401, 'invalid_refresh_token');
  assert.deepEqual(closedRooms, [{ room: `device:${other.deviceId}`, close: true }]);
  assert.equal((await login(email('change'), NEW)).statusCode, 200);
});

test('a wrong current password is a 401, and the 6th failure a 429', async () => {
  const id = await createAccount('guess');
  const { accessToken } = await newSession(id);
  const wrong = { currentPassword: 'not the password', newPassword: NEW };

  for (let i = 0; i < 5; i++) {
    assertProblem(await change(accessToken, wrong), 401, 'invalid_credentials');
  }
  // Even the right password is refused once the limit is hit
  assertProblem(
    await change(accessToken, { currentPassword: OLD, newPassword: NEW }),
    429,
    'rate_limited',
  );
});

test('a Google-only account gets 409 no_password; no token gets 401', async () => {
  const id = await createAccount('googleonly', { withPassword: false });
  const { accessToken } = await newSession(id);
  const body = { currentPassword: 'anything', newPassword: NEW };

  assertProblem(await change(accessToken, body), 409, 'no_password');
  assertProblem(await change(null, body), 401, 'unauthorized');
});

test('no password, reset token or session token ever reaches the logs', async () => {
  const output = logChunks.join('');
  assert.ok(output.includes('password reset'), 'the reset is logged');
  for (const secret of secrets) assert.ok(!output.includes(secret), 'a secret reached the logs');
});

test('the password routes are documented with their answers', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  const expected = {
    '/v1/password-resets': ['post', ['202', '429']],
    '/v1/password-resets/confirm': ['post', ['204', '400']],
    '/v1/me/password': ['put', ['204', '401', '409', '429']],
  };
  for (const [path, [method, statuses]] of Object.entries(expected)) {
    const doc = spec.paths[path]?.[method];
    assert.ok(doc, `${method} ${path} missing`);
    for (const status of statuses) assert.ok(status in doc.responses, `${path} ${status}`);
  }
});

test('current-password guesses sent at once are limited too', async () => {
  const id = await createAccount('parallel');
  const { accessToken } = await newSession(id);

  const res = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      change(accessToken, { currentPassword: `guess ${i}`, newPassword: NEW }),
    ),
  );

  assert.equal(res.filter((r) => r.statusCode === 401).length, 5);
  assert.equal(res.filter((r) => r.statusCode === 429).length, 7);
});
