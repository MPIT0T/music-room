import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 5 });
export const pub = redis.duplicate();
export const sub = redis.duplicate();

for (const [name, client] of Object.entries({ redis, pub, sub })) {
  client.on('error', (err) => console.error(`[redis:${name}]`, err.message));
}

export async function closeRedis() {
  await Promise.allSettled([redis.quit(), pub.quit(), sub.quit()]);
}

export default redis;