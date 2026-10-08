import Redis from 'ioredis';

// lazyConnect: importing this module must not open sockets (tests would hang);
// each client connects on its first command.
export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 5,
  lazyConnect: true,
});
export const pub = redis.duplicate();
export const sub = redis.duplicate();

for (const [name, client] of Object.entries({ redis, pub, sub })) {
  client.on('error', (err) => console.error(`[redis:${name}]`, err.message));
}

export default redis;
