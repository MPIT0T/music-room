import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const downPool = {
  query: async () => {
    throw new Error('connection refused');
  },
  end: async () => {},
};
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };
const downRedis = {
  ping: async () => {
    throw new Error('ECONNREFUSED');
  },
  quit: async () => 'OK',
};

// Integration test: real MariaDB and Redis (run through make test)
test('GET /health returns ok when db and redis answer', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', db: 'ok', redis: 'ok' });
});

test('GET /health returns 503 when the database is down', async (t) => {
  const app = await buildApp({ pool: downPool, redis: okRedis, logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: 'error', db: 'down', redis: 'ok' });
});

test('GET /health returns 503 when redis is down', async (t) => {
  const app = await buildApp({ pool: okPool, redis: downRedis, logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: 'error', db: 'ok', redis: 'down' });
});

test('app.close() closes the injected db pool and redis client', async () => {
  const closed = [];
  const app = await buildApp({
    pool: { ...okPool, end: async () => closed.push('db') },
    redis: { ...okRedis, quit: async () => closed.push('redis') },
    logger: false,
  });

  await app.close();

  assert.deepEqual(closed.sort(), ['db', 'redis']);
});
