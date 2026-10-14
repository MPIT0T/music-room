import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

// The playground mints tokens without a password: it must only exist when asked for
test('the dev playground is not registered unless devTools is on', async (t) => {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false, devTools: false });
  t.after(() => app.close());

  const page = await app.inject({ url: '/dev' });
  const mint = await app.inject({ method: 'POST', url: '/dev/users', payload: {} });

  assert.equal(page.statusCode, 404);
  assert.equal(mint.statusCode, 404);
});

test('with devTools on, /dev serves the page and stays out of /docs', async (t) => {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false, devTools: true });
  t.after(() => app.close());

  const page = await app.inject({ url: '/dev' });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /^text\/html/);

  const docs = await app.inject({ url: '/docs/json' });
  assert.ok(!Object.keys(docs.json().paths).some((path) => path.startsWith('/dev')));
});
