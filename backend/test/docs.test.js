import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

async function getSpec(t) {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/docs/json' });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test('GET /docs/json serves an OpenAPI spec with a string version', async (t) => {
  const spec = await getSpec(t);

  assert.match(spec.openapi, /^3\./);
  assert.equal(spec.info.title, 'Music Room API');
  // OpenAPI requires a string: a number here breaks client generators
  assert.equal(typeof spec.info.version, 'string');
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
});

// Fails if swagger is registered after the routes (or without await): they would vanish from the docs
test('GET /health is documented with its 200 and 503 responses', async (t) => {
  const spec = await getSpec(t);

  const health = spec.paths['/health']?.get;
  assert.ok(health, '/health missing from the spec');
  assert.deepEqual(Object.keys(health.responses).sort(), ['200', '503']);
});

test('GET /docs serves the Swagger UI', async (t) => {
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/docs' });

  assert.ok(res.statusCode < 400, `got ${res.statusCode}`);
});
