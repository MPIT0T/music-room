import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { clientHeader, loggerOptions } from '../src/logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

// Builds the real app with its real logger config, writing into memory instead of stdout
async function appWithCapturedLogs(t) {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: loggerOptions({ stream }) });
  t.after(() => app.close());

  // Simulates a careless route that logs everything it receives
  app.post('/v1/echo/:id', async (req) => {
    req.log.info({ body: req.body, headers: req.headers, query: req.query }, 'debug dump');
    return { ok: true };
  });
  app.get('/v1/boom', async () => {
    throw new Error('kaboom');
  });

  const raw = () => chunks.join('');
  const lines = () =>
    raw()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  const completed = () => lines().filter((l) => l.msg === 'request completed');
  return { app, raw, lines, completed };
}

test('the server generates the request id and ignores the client one', async (t) => {
  const { app, completed } = await appWithCapturedLogs(t);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/echo/1',
    headers: { 'x-request-id': 'forged-id' },
    payload: {},
  });

  const id = res.headers['x-request-id'];
  assert.match(id, UUID);
  assert.equal(completed()[0].reqId, id);
});

test('the completion line has the route pattern, status, duration and client context', async (t) => {
  const { app, completed } = await appWithCapturedLogs(t);

  await app.inject({
    method: 'POST',
    url: '/v1/echo/42?page=2',
    headers: { 'x-platform': 'android', 'x-device': 'D'.repeat(500) },
    payload: {},
  });

  const [line] = completed();
  assert.equal(line.route, '/v1/echo/:id');
  assert.equal(line.method, 'POST');
  assert.equal(line.statusCode, 200);
  assert.equal(typeof line.durationMs, 'number');
  assert.equal(line.platform, 'android');
  assert.equal(line.device, 'D'.repeat(64));
  assert.equal(line.appVersion, 'unknown');
});

test('no secret reaches the logs, even when a route logs everything', async (t) => {
  const { app, raw } = await appWithCapturedLogs(t);
  const secrets = [
    'BEARER_SECRET',
    'COOKIE_SECRET',
    'PASSWORD_SECRET',
    'TOKEN_SECRET',
    'REFRESH_SECRET',
    'ID_TOKEN_SECRET',
    'QUERY_SECRET',
  ];

  await app.inject({
    method: 'POST',
    url: '/v1/echo/1?token=QUERY_SECRET',
    headers: { authorization: 'Bearer BEARER_SECRET', cookie: 'sid=COOKIE_SECRET' },
    payload: {
      email: 'a@b.c',
      password: 'PASSWORD_SECRET',
      token: 'TOKEN_SECRET',
      refreshToken: 'REFRESH_SECRET',
      google: { idToken: 'ID_TOKEN_SECRET' },
    },
  });

  const output = raw();
  for (const secret of secrets) assert.ok(!output.includes(secret), `${secret} leaked`);
  assert.ok(output.includes('[REDACTED]'));
});

test('unknown routes and errors never log the raw URL', async (t) => {
  const { app, raw, lines, completed } = await appWithCapturedLogs(t);

  await app.inject({ method: 'GET', url: '/v1/reset?token=QUERY_SECRET' });
  await app.inject({ method: 'GET', url: '/v1/boom?token=QUERY_SECRET' });

  assert.ok(!raw().includes('QUERY_SECRET'));
  // The 500 is still logged with its error, only the URL is hidden
  assert.ok(lines().some((l) => l.level >= 50 && l.err?.message === 'kaboom'));
  assert.deepEqual(
    completed().map((l) => [l.route, l.statusCode]),
    [
      ['not_found', 404],
      ['/v1/boom', 500],
    ],
  );
});

test('clientHeader keeps headers short, printable and never empty', () => {
  assert.equal(clientHeader(undefined), 'unknown');
  assert.equal(clientHeader('   '), 'unknown');
  assert.equal(clientHeader(['ios', 'android']), 'ios');
  assert.equal(clientHeader('1.2.0\n{"level":60}'), '1.2.0{"level":60}');
  assert.equal(clientHeader('x'.repeat(100)).length, 64);
});
