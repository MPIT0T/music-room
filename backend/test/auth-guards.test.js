import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { createTokenService } from '../src/auth/tokens.js';
import { requireAuth } from '../src/auth/guards.js';

const SECRET = 'a'.repeat(32);
const tokens = createTokenService(SECRET);

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

// One protected route that echoes what the hook stored, and counts how often the handler ran
async function appWithProtectedRoute(t) {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false, tokens });
  t.after(() => app.close());

  const calls = { handler: 0 };
  app.get('/v1/whoami', { onRequest: requireAuth }, async (request) => {
    calls.handler += 1;
    return { userId: request.userId, deviceId: request.deviceId };
  });
  return { app, calls };
}

function whoami(app, authorization) {
  return app.inject({
    url: '/v1/whoami',
    headers: authorization === undefined ? {} : { authorization },
  });
}

function assertUnauthorized(res) {
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.headers['www-authenticate'], 'Bearer');
  const body = res.json();
  assert.equal(body.code, 'unauthorized');
  assert.equal(body.type, '/problems/unauthorized');
  assert.equal(body.requestId, res.headers['x-request-id']);
  return body;
}

// Same claims as a real access token, but already expired
function expiredToken() {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ did: 'device-1' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('user-1')
    .setIssuer('music-room')
    .setAudience('music-room-api')
    .setIssuedAt(now - 3600)
    .setExpirationTime(now - 1800)
    .sign(new TextEncoder().encode(SECRET));
}

test('a valid access token lets the request through with the user and device ids', async (t) => {
  const { app } = await appWithProtectedRoute(t);
  const token = await tokens.signAccessToken({ userId: 'user-1', deviceId: 'device-1' });

  const res = await whoami(app, `Bearer ${token}`);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { userId: 'user-1', deviceId: 'device-1' });
});

test('a missing or malformed Authorization header is refused with 401 unauthorized', async (t) => {
  const { app, calls } = await appWithProtectedRoute(t);
  const token = await tokens.signAccessToken({ userId: 'user-1', deviceId: 'device-1' });

  for (const authorization of [undefined, '', 'Bearer', 'Bearer ', `Basic ${token}`, token]) {
    assertUnauthorized(await whoami(app, authorization));
  }
  assert.equal(calls.handler, 0);
});

test('a forged, foreign or expired token is refused with the same 401', async (t) => {
  const { app, calls } = await appWithProtectedRoute(t);
  const foreign = await createTokenService('b'.repeat(32)).signAccessToken({
    userId: 'user-1',
    deviceId: 'device-1',
  });
  const valid = await tokens.signAccessToken({ userId: 'user-1', deviceId: 'device-1' });
  // Same header and signature, payload swapped for another user
  const [head, , signature] = valid.split('.');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-2', did: 'device-1' })).toString(
    'base64url',
  );
  const tampered = `${head}.${payload}.${signature}`;

  const bodies = [];
  for (const token of ['forged.token.value', foreign, tampered, await expiredToken()]) {
    bodies.push(assertUnauthorized(await whoami(app, `Bearer ${token}`)));
  }

  // The client must not be able to tell why the token was refused
  for (const body of bodies) {
    assert.equal(body.title, bodies[0].title);
    assert.equal(body.detail, bodies[0].detail);
  }
  assert.equal(calls.handler, 0);
});

test('routes without the hook stay public', async (t) => {
  const { app } = await appWithProtectedRoute(t);

  const res = await app.inject({ url: '/health' });

  assert.equal(res.statusCode, 200);
});
