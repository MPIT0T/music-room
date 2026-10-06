import Fastify from 'fastify';
import { pool, redis } from './db/pool.js'

const app = Fastify({ logger: true });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  await redis.ping();
  return { status: 'ok', db: 'ok' };
});

await app.listen({ port: process.env.PORT, host: '0.0.0.0' });