import Fastify from 'fastify';
import { pool as defaultPool } from './db/pool.js';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';

// importer jwt ici

export async function buildApp({ pool = defaultPool, logger = true } = {}) {
  const app = Fastify({ logger }).withTypeProvider();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);


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
