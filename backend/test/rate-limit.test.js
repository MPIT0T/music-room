import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { redis } from '../src/utils/redis.js';
import { createRateLimiter } from '../src/security/rate-limit.js';

// Real Redis (make test); rule names unique to this run
const RUN = randomUUID().slice(0, 8);
let counter = 0;
const rule = (limit, windowSeconds = 60) => ({
  name: `test-${RUN}-${counter++}`,
  limit,
  windowSeconds,
});
const limiter = createRateLimiter(redis);

after(async () => {
  const keys = await redis.keys(`rl:test-${RUN}-*`);
  if (keys.length) await redis.del(keys);
  await redis.quit();
});

test('allows up to the limit, then refuses with the time left in the window', async () => {
  const r = rule(2, 60);

  const results = [];
  for (let i = 0; i < 3; i++) results.push(await limiter.consume(r, 'max@example.com'));

  assert.deepEqual(
    results.map((x) => x.allowed),
    [true, true, false],
  );
  assert.ok(results[2].retryAfter >= 1 && results[2].retryAfter <= 60, `${results[2].retryAfter}`);
});

test('each value has its own counter', async () => {
  const r = rule(1);

  await limiter.consume(r, 'a@example.com');

  assert.equal((await limiter.consume(r, 'a@example.com')).allowed, false);
  assert.equal((await limiter.consume(r, 'b@example.com')).allowed, true);
});

test('peek reads without counting', async () => {
  const r = rule(1);

  for (let i = 0; i < 3; i++) assert.equal((await limiter.peek(r, 'x')).allowed, true);
  assert.equal((await limiter.consume(r, 'x')).allowed, true);
  assert.equal((await limiter.peek(r, 'x')).allowed, false);
});

test('Redis keys hold a hash, never the email in clear', async () => {
  const r = rule(5);

  await limiter.consume(r, 'max@example.com');

  const keys = await redis.keys(`rl:${r.name}:*`);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^rl:[\w-]+:[0-9a-f]{64}$/);
  assert.ok(!keys[0].includes('max@example.com'));
});

test('a Redis outage lets the request through and is logged', async () => {
  const logs = [];
  const broken = {
    multi() {
      throw new Error('Connection is closed.');
    },
  };
  const failing = createRateLimiter(broken, { log: { error: (obj, msg) => logs.push(msg) } });

  assert.deepEqual(await failing.consume(rule(1), 'x'), { allowed: true });
  assert.deepEqual(logs, ['rate limiter unavailable, request allowed']);
});
