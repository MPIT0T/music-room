import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('GET /health returns ok when the database answers', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', db: 'ok' });
});

test('GET /health fails when the database is down', async (t) => {
  const fakePool = {
    query: async () => {
      throw new Error('connection refused');
    },
    end: async () => {},
  };
  const app = await buildApp({ pool: fakePool, logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 500);
});
