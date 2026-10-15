import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { createGoogleVerifier } from '../src/auth/google.js';
import { passwords } from '../src/auth/passwords.js';

// Integration tests: real MariaDB (make test). Google is replaced by a local RSA key:
// tokens are signed here and verified through the same jose code path, offline.
const RUN = randomUUID().slice(0, 8);
const WEB = 'web-client.apps.googleusercontent.com';
const ANDROID = 'android-client.apps.googleusercontent.com';
const DEVICE = { name: 'Pixel de Max', platform: 'android' };
const email = (name) => `oauth-${RUN}-${name}@example.com`;
const sub = (name) => `sub-${RUN}-${name}`;

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

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

let app;
let googleKey;
let otherKey;
let jwks;
const secrets = [];

before(async () => {
  googleKey = await generateKeyPair('RS256');
  otherKey = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(googleKey.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
  app = await buildApp({
    logger: loggerOptions({ stream }),
    googleVerifier: createGoogleVerifier({ audiences: [WEB, ANDROID], jwks }),
  });
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`oauth-${RUN}-%`]);
  await app.close();
});

// A Google ID token as google_sign_in returns it; overrides break one claim at a time
async function idToken(name, overrides = {}, { key = googleKey.privateKey } = {}) {
  const claims = {
    iss: 'https://accounts.google.com',
    aud: WEB,
    azp: ANDROID,
    sub: sub(name),
    email: email(name),
    email_verified: true,
    name: `Google ${name}`,
    ...overrides,
  };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '1h')
    .sign(key);
  secrets.push(token);
  return token;
}

async function signIn(token, extra = {}, target = app) {
  const res = await target.inject({
    method: 'POST',
    url: '/v1/sessions/oauth',
    payload: { provider: 'google', idToken: token, device: DEVICE, ...extra },
  });
  if (res.statusCode < 300) secrets.push(res.json().accessToken, res.json().refreshToken);
  return res;
}

async function createLocalAccount(name, { verified }) {
  const [[row]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES (?, ?, IF(?, NOW(3), NULL), ?) RETURNING id`,
    [email(name), await passwords.hash('correct horse battery'), verified, name],
  );
  return row.id;
}

async function userRow(id) {
  const [[row]] = await app.db.query(
    'SELECT email, password_hash, email_verified_at, display_name FROM users WHERE id = ?',
    [id],
  );
  return row;
}

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('a new Google account creates a verified user without password: 201', async () => {
  const res = await signIn(await idToken('newbie'));

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.deepEqual(await app.tokens.verifyAccessToken(body.accessToken), {
    userId: body.user.id,
    deviceId: body.deviceId,
  });
  assert.deepEqual(body.user, {
    id: body.user.id,
    email: email('newbie'),
    emailVerified: true,
    displayName: 'Google newbie',
    avatarUrl: null,
    plan: 'free',
    providers: ['google'],
  });
  assert.equal((await userRow(body.user.id)).password_hash, null);
});

test('signing in again with the same Google account: 200, same user, deviceId reused', async () => {
  const first = (await signIn(await idToken('again'))).json();

  const res = await signIn(await idToken('again'), { deviceId: first.deviceId });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.id, first.user.id);
  assert.equal(res.json().deviceId, first.deviceId);
});

test('a token issued to the Android client is accepted too', async () => {
  const res = await signIn(await idToken('android', { aud: ANDROID }));

  assert.equal(res.statusCode, 201);
});

test('a verified local account with the same email is linked, its password kept', async () => {
  const id = await createLocalAccount('local', { verified: true });

  const res = await signIn(await idToken('local'));

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.id, id);
  assert.deepEqual(res.json().user.providers, ['password', 'google']);
  assert.ok((await userRow(id)).password_hash);
});

test('an unverified local account is taken over by Google: its password is removed', async () => {
  // Someone registered the victim's address first and set a password (pre-hijacking)
  const id = await createLocalAccount('squatted', { verified: false });
  await app.db.query(
    "INSERT INTO email_tokens (token_hash, user_id, type, expires_at) VALUES (?, ?, 'verify_email', NOW(3) + INTERVAL 1 DAY)",
    [`${RUN}`.padEnd(64, '0'), id],
  );

  const res = await signIn(await idToken('squatted'));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().user.providers, ['google']);
  const row = await userRow(id);
  assert.equal(row.password_hash, null);
  assert.ok(row.email_verified_at instanceof Date);
  const [tokens] = await app.db.query('SELECT 1 FROM email_tokens WHERE user_id = ?', [id]);
  assert.equal(tokens.length, 0);
});

test('a Google email not verified by Google gives 403 and creates nothing', async () => {
  const res = await signIn(await idToken('unverified', { email_verified: false }));

  assertProblem(res, 403, 'oauth_email_not_verified');
  const [rows] = await app.db.query('SELECT 1 FROM users WHERE email = ?', [email('unverified')]);
  assert.equal(rows.length, 0);
});

test('an already linked account still signs in even if Google now says unverified', async () => {
  await signIn(await idToken('linked'));

  const res = await signIn(await idToken('linked', { email_verified: false }));

  assert.equal(res.statusCode, 200);
});

test('an email whose account has another Google account linked gives 409 already_linked', async () => {
  await signIn(await idToken('taken'));

  const res = await signIn(await idToken('taken', { sub: sub('someone-else') }));

  assertProblem(res, 409, 'already_linked');
});

test('two first sign-ins at the same time create one account: one 201, one 200', async () => {
  const [a, b] = await Promise.all([signIn(await idToken('race')), signIn(await idToken('race'))]);

  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 201]);
  assert.equal(a.json().user.id, b.json().user.id);
});

test('a bad ID token gives 401 invalid_oauth_token', async () => {
  const cases = {
    'signed by another key': await idToken('bad', {}, { key: otherKey.privateKey }),
    expired: await idToken('bad', { exp: Math.floor(Date.now() / 1000) - 60 }),
    'other audience': await idToken('bad', { aud: 'other.apps.googleusercontent.com' }),
    'other issuer': await idToken('bad', { iss: 'https://evil.example.com' }),
    'not a JWT': 'not-a-token',
  };
  for (const [label, token] of Object.entries(cases)) {
    assertProblem(await signIn(token), 401, 'invalid_oauth_token', label);
  }
});

test('a provider other than google gives 400 unsupported_provider', async () => {
  const res = await signIn(await idToken('fb'), { provider: 'facebook' });

  assertProblem(res, 400, 'unsupported_provider');
});

test('503 oauth_unavailable without client ID, or when Google keys cannot be fetched', async (t) => {
  const noConfig = await buildApp({
    pool: okPool,
    redis: okRedis,
    logger: false,
    googleVerifier: createGoogleVerifier({ audiences: [], jwks }),
  });
  const offline = await buildApp({
    pool: okPool,
    redis: okRedis,
    logger: false,
    googleVerifier: createGoogleVerifier({
      audiences: [WEB],
      jwks: async () => {
        throw new TypeError('fetch failed');
      },
    }),
  });
  t.after(() => Promise.all([noConfig.close(), offline.close()]));

  assertProblem(await signIn(await idToken('x'), {}, noConfig), 503, 'oauth_unavailable');
  assertProblem(await signIn(await idToken('x'), {}, offline), 503, 'oauth_unavailable');
});

test('aud and azp are logged, no ID token or session token is', async () => {
  const line = logLines().find((l) => l.msg === 'google sign-in');
  assert.ok(line, 'no sign-in line');
  assert.equal(line.aud, WEB);
  assert.equal(line.azp, ANDROID);
  assert.ok(line.userId);

  const output = logChunks.join('');
  assert.ok(secrets.length > 10);
  for (const secret of secrets) assert.ok(!output.includes(secret), 'a token reached the logs');
});

test('the oauth route is documented with its answers', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  const doc = spec.paths['/v1/sessions/oauth']?.post;
  for (const status of ['200', '201', '400', '401', '403', '409', '503']) {
    assert.ok(status in doc.responses, status);
  }
});
