import { createHash } from 'node:crypto';
import { HttpProblem } from '../errors.js';

// Hashed so Redis never holds emails or IPs in clear, and keys keep a fixed length
function keyOf(rule, value) {
  return `rl:${rule.name}:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function results(replies) {
  const failed = replies.find(([err]) => err);
  if (failed) throw failed[0];
  return replies.map(([, value]) => value);
}

export function createRateLimiter(redis, { log } = {}) {
  // Fail open: a cache outage must not lock every user out; argon2 still slows brute force meanwhile
  async function guarded(rule, attempt) {
    try {
      return await attempt();
    } catch (err) {
      log?.error(
        { rule: rule.name, message: err.message },
        'rate limiter unavailable, request allowed',
      );
      return { allowed: true };
    }
  }

  return {
    // Counts one attempt. Fixed window: the first hit starts it, EXPIRE NX never extends it
    consume: (rule, value) =>
      guarded(rule, async () => {
        const key = keyOf(rule, value);
        const [count, , ttl] = results(
          await redis.multi().incr(key).expire(key, rule.windowSeconds, 'NX').ttl(key).exec(),
        );
        return count <= rule.limit
          ? { allowed: true }
          : { allowed: false, retryAfter: Math.max(ttl, 1) };
      }),

    // Reads without counting: lets a route count only failures (login)
    peek: (rule, value) =>
      guarded(rule, async () => {
        const key = keyOf(rule, value);
        const [count, ttl] = results(await redis.multi().get(key).ttl(key).exec());
        return Number(count ?? 0) < rule.limit
          ? { allowed: true }
          : { allowed: false, retryAfter: Math.max(ttl, 1) };
      }),
  };
}

// preHandler: runs after body validation, so valueOf can read the normalized body
export function rateLimit(rule, valueOf) {
  return async (request) => {
    const { allowed, retryAfter } = await request.server.rateLimiter.consume(
      rule,
      valueOf(request),
    );
    if (!allowed) {
      throw new HttpProblem(429, 'rate_limited', {
        headers: { 'retry-after': String(retryAfter) },
      });
    }
  };
}
