import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerProblemHandlers } from './errors.js';
import { pool as defaultPool } from './db/pool.js';
import { redis as defaultRedis } from './utils/redis.js';
import { loggerOptions, loggingOptions, registerRequestLogging } from './logger.js';
import { readGoogleConfig, readMailConfig } from './config.js';
import { createTokenService } from './auth/tokens.js';
import { createMailer } from './mail/mailer.js';

export async function buildApp({
  pool = defaultPool,
  redis = defaultRedis,
  logger = loggerOptions(),
  google = readGoogleConfig(),
  tokens = createTokenService(),
  mailConfig = readMailConfig(),
  mailer,
} = {}) {
  const app = Fastify({ ...loggingOptions, logger }).withTypeProvider();
  registerRequestLogging(app);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerProblemHandlers(app);

  // Shared clients and config, available everywhere as app.db / app.redis / app.google / app.tokens / app.mailer
  app.decorate('db', pool);
  app.decorate('redis', redis);
  app.decorate('google', google);
  app.decorate('tokens', tokens);
  // Built here because the default mailer logs through app.log, which only exists now
  app.decorate('mailer', mailer ?? createMailer(mailConfig, { log: app.log }));
  // The app closes what it was given. onClose hooks run last-registered-first,
  // so the socket layer (registered later in server.js) is already closed here.
  app.addHook('onClose', async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
  });

  // logLevel warn: the CI and Docker healthchecks poll this route, only failures are worth a line
  app.get('/health', { logLevel: 'warn' }, async (req, reply) => {
    // allSettled: report every dependency, not just the first one that fails
    const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
    const body = {
      status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'error',
      db: db.status === 'fulfilled' ? 'ok' : 'down',
      redis: cache.status === 'fulfilled' ? 'ok' : 'down',
    };
    if (body.status === 'ok') return body;

    // Details go to the logs only: the public response must not leak internal errors
    req.log.error({ db: db.reason?.message, redis: cache.reason?.message }, 'health check failed');
    return reply.code(503).send(body);
  });

  return app;
}
