import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { createGoogleVerifier } from '../src/auth/google.js';

// Integration tests: real MariaDB (make test). Google is replaced by a local RSA key, offline.
const RUN = randomUUID().slice(0, 8);
const WEB = 'web-client.apps.googleusercontent.com';
const email = (name) => `link-${RUN}-${name}@example.com`;
const sub = (name) => `link-sub-${RUN}-${name}`;

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

const logChunks = [];
const stream = new Writable({
  write(chunk, _enc, done) {
    logChunks.push(chunk.toString());
    done();
  },
});

let app;
let key;
let jwks;
const users = {};
const secrets = [];

before(async () => {
  key = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(key.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
  app = await buildApp({
    logger: loggerOptions({ stream }),
    googleVerifier: createGoogleVerifier({ audiences: [WEB], jwks }),
  });
  for (const name of ['max', 'eve', 'twice', 'racer']) await createUser(name);
  await createUser('googleonly', { withPassword: false });
});

after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`link-${RUN}-%`]);
  await app.close();
});

async function createUser(name, { withPassword = true } = {}) {
  const [[row]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES (?, ?, NOW(3), ?) RETURNING id`,
    [email(name), withPassword ? 'x' : null, name],
  );
  users[name] = {
    id: row.id,
    token: await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() }),
  };
}

// A Google account whose email differs from the Music Room one (allowed by the contract)
async function idToken(googleName, overrides = {}) {
  const token = await new SignJWT({
    iss: 'https://accounts.google.com',
    aud: WEB,
    sub: sub(googleName),
    email: `${googleName}-${RUN}@gmail.example`,
    email_verified: true,
    name: googleName,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key.privateKey);
  secrets.push(token);
  return token;
}

const link = (who, token, target = app) =>
  target.inject({
    method: 'PUT',
    url: '/v1/me/oauth/google',
    headers: who ? { authorization: `Bearer ${users[who].token}` } : {},
    payload: { idToken: token },
  });
const unlink = (who) =>
  app.inject({
    method: 'DELETE',
    url: '/v1/me/oauth/google',
    headers: who ? { authorization: `Bearer ${users[who].token}` } : {},
  });
const googleSignIn = async (token) => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sessions/oauth',
    payload: { provider: 'google', idToken: token, device: { name: 't', platform: 'web' } },
  });
  if (res.statusCode < 300) secrets.push(res.json().accessToken, res.json().refreshToken);
  return res;
};

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('linking a Google account adds it to providers, and Google sign-in then opens this account', async () => {
  const res = await link('max', await idToken('max-google'));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().providers, ['password', 'google']);
  assert.equal(res.json().id, users.max.id);

  const signIn = await googleSignIn(await idToken('max-google'));
  assert.equal(signIn.statusCode, 200);
  assert.equal(signIn.json().user.id, users.max.id);
});

test('linking the same Google account again is a 200', async () => {
  await link('twice', await idToken('twice-google'));

  const res = await link('twice', await idToken('twice-google'));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().providers, ['password', 'google']);
});

test('a second, different Google account gives 409 already_linked', async () => {
  // max already has max-google from the first test
  assertProblem(await link('max', await idToken('another-google')), 409, 'already_linked');
});

test("someone else's Google account gives 409 oauth_account_in_use", async () => {
  assertProblem(await link('eve', await idToken('max-google')), 409, 'oauth_account_in_use');
});

test('two link requests at once for the same Google account: one 200, one 409', async () => {
  const token = await idToken('race-google');

  const [a, b] = await Promise.all([link('racer', token), link('eve', token)]);

  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
});

test('a bad ID token is a 401; no client ID configured is a 503', async (t) => {
  assertProblem(await link('eve', 'not-a-token'), 401, 'invalid_oauth_token');
  assertProblem(
    await link('eve', await idToken('x', { aud: 'other.apps' })),
    401,
    'invalid_oauth_token',
  );

  const noConfig = await buildApp({
    pool: okPool,
    redis: okRedis,
    logger: false,
    tokens: app.tokens,
    googleVerifier: createGoogleVerifier({ audiences: [], jwks }),
  });
  t.after(() => noConfig.close());
  assertProblem(await link('eve', await idToken('x'), noConfig), 503, 'oauth_unavailable');
});

test('unlinking removes the provider; Google sign-in no longer reaches the account', async () => {
  await link('eve', await idToken('eve-google'));

  const res = await unlink('eve');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().providers, ['password']);
  const signIn = await googleSignIn(await idToken('eve-google'));
  assert.notEqual(signIn.json().user?.id, users.eve.id);
});

test('unlinking without a linked Google account is a 404 not_linked', async () => {
  const fresh = 'fresh';
  await createUser(fresh);

  assertProblem(await unlink(fresh), 404, 'not_linked');
});

test('a Google-only account cannot unlink its last login method', async () => {
  await app.db.query(
    "INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', ?)",
    [users.googleonly.id, sub('googleonly')],
  );

  assertProblem(await unlink('googleonly'), 409, 'last_login_method');
  const [[row]] = await app.db.query('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?', [
    users.googleonly.id,
  ]);
  assert.equal(Number(row.n), 1);
});

test('both routes need an access token', async () => {
  assertProblem(await link(null, await idToken('x')), 401, 'unauthorized');
  assertProblem(await unlink(null), 401, 'unauthorized');
});

test('no ID token or session token reaches the logs', async () => {
  const output = logChunks.join('');
  assert.ok(output.includes('google account linked'));
  for (const secret of secrets) assert.ok(!output.includes(secret), 'a token reached the logs');
});

test('link and unlink are documented', async () => {
  const spec = (await app.inject({ url: '/docs/json' })).json();
  const path = spec.paths['/v1/me/oauth/google'];

  for (const status of ['200', '401', '409', '503'])
    assert.ok(status in path.put.responses, status);
  for (const status of ['200', '404', '409']) assert.ok(status in path.delete.responses, status);
});
