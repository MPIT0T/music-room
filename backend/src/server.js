import Fastify from 'fastify';
import { pool } from './db/pool.js';
import redis from './utils/redis.js';
import { socketSetup }  from './utils/socket.js'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';

// importer jwt ici

const app = Fastify({ logger: true }).withTypeProvider();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

const io = socketSetup(app.server);

app.decorate('io', io);

app.get('/health', async () => {
  await pool.query('SELECT 1');
  await redis.ping();
  return { status: 'ok', db: 'ok', redis: 'ok' };
});

app.addHook('preClose', async () => {
  io.local.disconnectSockets(true);  // coupe les clients avant la fermeture HTTP
});
app.addHook('onClose', async () => {
  await io.close();
  await closeRedis();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => app.close());
}

await app.listen({ port: process.env.PORT ?? 3000, host: '0.0.0.0' });