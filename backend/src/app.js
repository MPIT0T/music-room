import Fastify from 'fastify';
import { pool as defaultPool } from './db/pool.js';

export async function buildApp({ pool = defaultPool, logger = true } = {}) {
  const app = Fastify({ logger });

  // Shared DB pool, available everywhere as app.db
  app.decorate('db', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.get('/health', async () => {
    await app.db.query('SELECT 1');
    return { status: 'ok', db: 'ok' };
  });

  return app;
}
