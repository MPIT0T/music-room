import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { passwords as realPasswords } from '../src/auth/passwords.js';

// Integration tests: real MariaDB and Redis (make test). Accounts are created directly in the DB.
const RUN = randomUUID().slice(0, 8);
const email = (name) => `login-${RUN}-${name}@example.com`;
const PASSWORD = 'correct horse battery';
const DEVICE = { name: 'Pixel de Max', platform: 'android', model: 'Pixel 7', appVersion: '1.2.0' };
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

// Counts verify calls to prove every failure path does the same argon2 work
const passwords = {
  verifyCalls: 0,
  hash: realPasswords.hash,
  verify(hash, plain) {
    this.verifyCalls++;
    return realPasswords.verify(hash, plain);
  },
};

// Unique names per run; the per-IP limit is lowered to test it
const limits = {
  signup: { name: `signup-${RUN}`, limit: 30, windowSeconds: 60 },
  resendVerification: { name: `resend-${RUN}`, limit: 1, windowSeconds: 60 },
  login: { name: `login-${RUN}`, limit: 5, windowSeconds: 900 },
  loginIp: { name: `login-ip-${RUN}`, limit: 8, windowSeconds: 900 },
};

const logChunks = [];
const stream = new Writable({
  write(chunk, _enc, done) {
    logChunks.push(chunk.toString());
    done();
  },
});

let app;
const accounts = {};
async function createAccount(name, { verified = true, withPassword = true, google = false } = {}) {
  const address = email(name);
  const hash = withPassword ? await realPasswords.hash(PASSWORD) : null;
  const [[user]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES (?, ?, IF(?, NOW(3), NULL), ?) RETURNING id`,
    [address, hash, verified, name],
  );
  if (google) {
    await app.db.query(
      "INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', ?)",
      [user.id, `google-${RUN}-${name}`],
    );
  }
  accounts[name] = { id: user.id, email: address };
}

before(async () => {
  app = await buildApp({ passwords, limits, logger: loggerOptions({ stream }) });
  await createAccount('max');
  await createAccount('eve');
  await createAccount('unverified', { verified: false });
  await createAccount('googleonly', { withPassword: false, google: true });
  for (let i = 0; i < 3; i++) await createAccount(`limited${i}`);
});
beforeEach(() => {
  passwords.verifyCalls = 0;
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`login-${RUN}-%`]);
  const keys = await app.redis.keys(`rl:*-${RUN}:*`);
  if (keys.length) await app.redis.del(keys);
  await app.close();
});

let ipCounter = 0;
const freshIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const login = (body, ip = freshIp()) =>
  app.inject({ method: 'POST', url: '/v1/sessions', payload: body, remoteAddress: ip });
const credentials = (name, password = PASSWORD, extra = {}) => ({
  email: accounts[name]?.email ?? email(name),
  password,
  device: DEVICE,
  ...extra,
});

async function deviceRow(id) {
  const [[row]] = await app.db.query(
    'SELECT user_id, name, refresh_hash, previous_refresh_hash, refresh_expires_at FROM devices WHERE id = ?',
    [id],
  );
  return row;
}

test('a correct password opens a session bound to a new device', async () => {
  const res = await login(credentials('max'));

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(await app.tokens.verifyAccessToken(body.accessToken), {
    userId: accounts.max.id,
    deviceId: body.deviceId,
  });
  assert.equal(body.accessTokenExpiresIn, 900);
  assert.equal(body.refreshTokenExpiresIn, 30 * 24 * 60 * 60);
  assert.deepEqual(body.user, {
    id: accounts.max.id,
    email: accounts.max.email,
    emailVerified: true,
    displayName: 'max',
    avatarUrl: null,
    plan: 'free',
    providers: ['password'],
  });

  const row = await deviceRow(body.deviceId);
  assert.equal(row.user_id, accounts.max.id);
  assert.equal(row.refresh_hash, sha256(body.refreshToken));
  assert.notEqual(row.refresh_hash, body.refreshToken);
  const days = (new Date(row.refresh_expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, `${days} days`);
});

test('unknown email, wrong password and Google-only account get the same 401 after the same work', async () => {
  const answers = [];
  for (const body of [
    credentials('nobody'),
    credentials('max', 'wrong password'),
    credentials('googleonly'),
  ]) {
    const res = await login(body);
    answers.push({
      status: res.statusCode,
      code: res.json().code,
      type: res.headers['content-type'],
    });
  }

  assert.equal(new Set(answers.map((a) => JSON.stringify(a))).size, 1);
  assert.deepEqual(answers[0], {
    status: 401,
    code: 'invalid_credentials',
    type: 'application/problem+json; charset=utf-8',
  });
  assert.equal(passwords.verifyCalls, 3);
});

test('email_not_verified only comes after the right password', async () => {
  assert.equal(
    (await login(credentials('unverified', 'wrong password'))).json().code,
    'invalid_credentials',
  );

  const res = await login(credentials('unverified'));

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'email_not_verified');
});

test('after 5 failures even the right password gets a 429; other accounts are not blocked', async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) {
    assert.equal((await login(credentials('eve', 'wrong password'), ip)).statusCode, 401);
  }

  const blocked = await login(credentials('eve'), ip);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().code, 'rate_limited');
  const retryAfter = Number(blocked.headers['retry-after']);
  assert.ok(retryAfter >= 1 && retryAfter <= 900, `retry-after ${retryAfter}`);

  assert.equal((await login(credentials('max'), ip)).statusCode, 200);
});

test('one IP trying many accounts is limited, whatever the email', async () => {
  const ip = freshIp();
  for (let i = 0; i < 8; i++) {
    await login(credentials(`limited${i % 3}`, `wrong ${i}`), ip);
  }

  assert.equal((await login(credentials('limited0'), ip)).statusCode, 429);
  assert.equal((await login(credentials('limited0'), freshIp())).statusCode, 200);
});

test('a successful login resets the failure counter of that IP + email', async () => {
  const ip = freshIp();
  for (let i = 0; i < 4; i++) await login(credentials('limited1', 'wrong password'), ip);
  assert.equal((await login(credentials('limited1'), ip)).statusCode, 200);

  for (let i = 0; i < 4; i++) {
    assert.equal((await login(credentials('limited1', 'wrong password'), ip)).statusCode, 401);
  }
});

test('the same deviceId reuses the device row with a fresh refresh token', async () => {
  const first = (await login(credentials('max'))).json();
  const renamed = { ...DEVICE, name: 'Pixel perso' };

  const second = (
    await login(credentials('max', PASSWORD, { deviceId: first.deviceId, device: renamed }))
  ).json();

  assert.equal(second.deviceId, first.deviceId);
  assert.notEqual(second.refreshToken, first.refreshToken);
  const row = await deviceRow(first.deviceId);
  assert.equal(row.name, 'Pixel perso');
  assert.equal(row.refresh_hash, sha256(second.refreshToken));
  // Cleared, not set to the old token: a late refresh with it must not count as theft
  assert.equal(row.previous_refresh_hash, null);
});

test("another user's deviceId gives a new device and leaves theirs untouched", async () => {
  const maxSession = (await login(credentials('max'))).json();
  const before = await deviceRow(maxSession.deviceId);

  const res = await login(
    credentials('eve', PASSWORD, { deviceId: maxSession.deviceId }),
    freshIp(),
  );

  assert.equal(res.statusCode, 200);
  assert.notEqual(res.json().deviceId, maxSession.deviceId);
  assert.deepEqual(await deviceRow(maxSession.deviceId), before);
});

test('unknown or malformed deviceId: a new device or a 400, never an error about the id', async () => {
  const unknown = await login(credentials('max', PASSWORD, { deviceId: randomUUID() }));
  assert.equal(unknown.statusCode, 200);

  const malformed = await login(credentials('max', PASSWORD, { deviceId: "' OR 1=1 -- " }));
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, 'validation_failed');
});

test('no password and no token ever reach the logs', async () => {
  const body = (await login(credentials('max'))).json();
  await login(credentials('max', 'wrong password'));

  const output = logChunks.join('');
  for (const secret of [PASSWORD, 'wrong password', body.accessToken, body.refreshToken]) {
    assert.ok(!output.includes(secret), 'a secret reached the logs');
  }
});

test('the login route is documented with its answers', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  const responses = Object.keys(spec.paths['/v1/sessions'].post.responses);
  for (const status of ['200', '401', '403', '429']) assert.ok(responses.includes(status), status);
});
