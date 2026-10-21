import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safeText } from '../validation.js';

// Development only (see buildApp): a page to try the API by hand, at http://localhost:3000/dev.
// It also mints access tokens without a password, so it must never be registered in production.
export default async function playgroundRoutes(app) {
  const pageUrl = new URL('./playground.html', import.meta.url);
  // Fails at startup, not on the first visit, if the page is missing
  await readFile(pageUrl);

  // Read on every visit: node --watch only restarts on imported .js files, so a page read
  // once at startup would hide every edit of playground.html until the API restarts
  app.get('/dev', { schema: { hide: true } }, async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(await readFile(pageUrl, 'utf8')),
  );

  const devUserBody = z.object({ displayName: safeText({ min: 1, max: 50 }) });

  // Stand-in for login until POST /v1/sessions exists: creates a user with no email or password
  app.post('/dev/users', { schema: { hide: true, body: devUserBody } }, async (request, reply) => {
    const [[user]] = await app.db.query(
      'INSERT INTO users (display_name) VALUES (?) RETURNING id, display_name',
      [request.body.displayName],
    );
    const accessToken = await app.tokens.signAccessToken({
      userId: user.id,
      deviceId: randomUUID(),
    });
    return reply.code(201).send({
      user: { id: user.id, displayName: user.display_name },
      accessToken,
    });
  });

  // Access tokens live 15 minutes: the page asks for a new one instead of creating another user
  app.post(
    '/dev/users/:id/token',
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const [[user]] = await app.db.query('SELECT id FROM users WHERE id = ?', [request.params.id]);
      if (user == null) return reply.code(404).send({ code: 'not_found' });
      const accessToken = await app.tokens.signAccessToken({
        userId: user.id,
        deviceId: randomUUID(),
      });
      return { accessToken };
    },
  );
}
