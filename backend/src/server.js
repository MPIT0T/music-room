import Fastify from 'fastify';
import { pool } from './db/pool.js';
import redis from './redis.js';
import { socketSetup }  from './socket.js'

const app = Fastify({ logger: true });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  await redis.ping();
  return { status: 'ok', db: 'ok', redis: 'ok' };
});

socketSetup(app);

await app.listen({ port: process.env.PORT ?? 3000, host: '0.0.0.0' });