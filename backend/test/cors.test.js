import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readCorsConfig } from '../src/config.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };
const WEB_APP = 'http://localhost:5000';

async function appWithCors(t, origins) {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false, cors: { origins } });
  t.after(() => app.close());
  return app;
}

const preflight = (app, origin) =>
  app.inject({
    method: 'OPTIONS',
    url: '/v1/sessions/oauth',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });

test('the web app origin may call the API, with the headers it needs', async (t) => {
  const app = await appWithCors(t, [WEB_APP]);

  const res = await preflight(app, WEB_APP);

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], WEB_APP);
  assert.match(res.headers['access-control-allow-headers'], /Authorization/);
  assert.match(res.headers['access-control-allow-methods'], /DELETE/);
  // Without credentials: tokens are sent by the app in a header, never as cookies
  assert.equal(res.headers['access-control-allow-credentials'], undefined);

  const health = await app.inject({ url: '/health', headers: { origin: WEB_APP } });
  assert.equal(health.headers['access-control-allow-origin'], WEB_APP);
});

test('any other origin gets no CORS header, so the browser hides the answer', async (t) => {
  const app = await appWithCors(t, [WEB_APP]);

  for (const origin of ['https://evil.example.com', 'http://localhost:5001', 'null']) {
    const res = await app.inject({ url: '/health', headers: { origin } });
    assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
  }
});

test('without configured origins CORS is off', async (t) => {
  const app = await appWithCors(t, []);

  const res = await app.inject({ url: '/health', headers: { origin: WEB_APP } });

  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('readCorsConfig splits the list and rejects anything that is not an origin', () => {
  assert.deepEqual(readCorsConfig({}).origins, []);
  assert.deepEqual(readCorsConfig({ CORS_ORIGINS: '' }).origins, []);
  assert.deepEqual(
    readCorsConfig({ CORS_ORIGINS: ' http://localhost:5000 , https://music.example.com' }).origins,
    ['http://localhost:5000', 'https://music.example.com'],
  );
  for (const bad of ['localhost:5000', 'http://localhost:5000/', 'https://a.com/path', '*']) {
    assert.throws(() => readCorsConfig({ CORS_ORIGINS: bad }), undefined, bad);
  }
});
