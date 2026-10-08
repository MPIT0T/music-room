import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { HttpProblem } from '../src/errors.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

async function appWithRoutes(t) {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false });
  t.after(() => app.close());

  app.post(
    '/v1/things',
    { schema: { body: z.object({ email: z.email(), password: z.string().min(8) }) } },
    async () => ({ ok: true }),
  );
  app.get('/v1/expected', async () => {
    throw new HttpProblem(429, 'rate_limited', { headers: { 'retry-after': '60' } });
  });
  app.get('/v1/bug', async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.12:3306');
  });
  return app;
}

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.equal(body.type, `/problems/${code.replaceAll('_', '-')}`);
  assert.equal(body.requestId, res.headers['x-request-id']);
  return body;
}

test('schema violations become 400 validation_failed with one entry per field', async (t) => {
  const app = await appWithRoutes(t);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/things',
    payload: { email: 'nope', password: 'short' },
  });

  const body = assertProblem(res, 400, 'validation_failed');
  assert.deepEqual(body.errors.map((e) => e.path).sort(), ['email', 'password']);
});

test('an HttpProblem keeps its status, code and headers', async (t) => {
  const app = await appWithRoutes(t);

  const res = await app.inject({ method: 'GET', url: '/v1/expected' });

  assertProblem(res, 429, 'rate_limited');
  assert.equal(res.headers['retry-after'], '60');
});

test('an unexpected error is a generic 500 that leaks nothing internal', async (t) => {
  const app = await appWithRoutes(t);

  const res = await app.inject({ method: 'GET', url: '/v1/bug' });

  assertProblem(res, 500, 'internal_error');
  assert.ok(!res.body.includes('ECONNREFUSED'));
  assert.ok(!res.body.includes('10.0.0.12'));
});

test('framework errors and unknown routes use the same format', async (t) => {
  const app = await appWithRoutes(t);

  const badJson = await app.inject({
    method: 'POST',
    url: '/v1/things',
    headers: { 'content-type': 'application/json' },
    payload: '{"email":',
  });
  const unknown = await app.inject({ method: 'GET', url: '/v1/nothing-here' });

  assertProblem(badJson, 400, 'bad_request');
  assertProblem(unknown, 404, 'not_found');
});
