import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { consumeEmailToken, issueEmailToken } from '../auth/email-tokens.js';
import { requireAuth } from '../auth/guards.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { disconnectDevice, disconnectUser } from '../auth/sockets.js';
import { sendInBackground } from '../mail/background.js';
import { emailField, passwordField } from '../validation.js';
import { rateLimit, tooManyRequests } from '../security/rate-limit.js';

const resetRequestBody = z.object({ email: emailField });

const resetConfirmBody = z.object({
  // Exactly what issueEmailToken produces: anything else never reaches SQL
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: passwordField,
});

const changeBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordField,
});

export default async function passwordsRoutes(app) {
  const requestSchema = {
    tags: ['auth'],
    summary: 'Ask for a password reset link',
    description:
      'Always 202. If the account exists, a link valid 1 h is emailed and older links stop working. ' +
      'Google-only accounts get one too: it is how they set a password. 3 requests per hour ' +
      'per email, counted whether the account exists or not.',
    body: resetRequestBody,
    response: { 202: z.null(), 429: problemSchema },
  };
  // Limited before the lookup: an unknown email is throttled exactly like a real one
  const requestLimit = rateLimit(app.limits.passwordReset, (request) => request.body.email);

  app.post(
    '/v1/password-resets',
    { schema: requestSchema, preHandler: requestLimit },
    async (request, reply) => {
      const { email } = request.body;
      const [[user]] = await app.db.query('SELECT id FROM users WHERE email = ?', [email]);
      // Known account: one extra write (about 1 ms) that the 3/h limit keeps from being measured
      if (user) {
        const token = await withTransaction(app.db, (conn) =>
          issueEmailToken(conn, user.id, 'reset_password'),
        );
        sendInBackground(request, app.mailer.sendPasswordReset(email, { token }), 'password reset');
      }
      return reply.code(202).send();
    },
  );

  const confirmSchema = {
    tags: ['auth'],
    summary: 'Set a new password with the token from the reset link',
    description:
      'Single use. Signs out every device of the account and marks the email verified ' +
      '(the link proves the mailbox belongs to the user).',
    body: resetConfirmBody,
    response: { 204: z.null(), 400: problemSchema },
  };

  app.post('/v1/password-resets/confirm', { schema: confirmSchema }, async (request, reply) => {
    const { token, newPassword } = request.body;
    const userId = await withTransaction(app.db, async (conn) => {
      const owner = await consumeEmailToken(conn, token, 'reset_password');
      if (!owner) return null;
      // Hashed only once the token is known to be good: a random token costs no argon2 work
      const hash = await app.passwords.hash(newPassword);
      await conn.query(
        `UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW(3))
         WHERE id = ?`,
        [hash, owner],
      );
      // Whoever knew the old password (or stole a session) is signed out everywhere
      await revokeUserSessions(conn, owner);
      return owner;
    });
    if (!userId) throw new HttpProblem(400, 'invalid_token');

    // After the commit: withTransaction may replay its function
    disconnectUser(app, userId);
    request.log.info({ userId }, 'password reset');
    return reply.code(204).send();
  });

  const changeSchema = {
    tags: ['auth'],
    summary: 'Change my password',
    description:
      'Needs the current password. Signs out every other device; this one stays signed in. ' +
      'Google-only accounts get 409 no_password: they set one through a reset link.',
    security: [{ bearerAuth: [] }],
    body: changeBody,
    response: { 204: z.null(), 401: problemSchema, 409: problemSchema, 429: problemSchema },
  };

  app.put(
    '/v1/me/password',
    { schema: changeSchema, onRequest: requireAuth },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const { userId, deviceId } = request;
      const rule = app.limits.changePassword;

      // Checked before argon2: once the limit is hit, even the right password is refused
      const { allowed, retryAfter } = await app.rateLimiter.peek(rule, userId);
      if (!allowed) throw tooManyRequests(retryAfter);

      const [[user]] = await app.db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
      if (!user?.password_hash) throw new HttpProblem(409, 'no_password');
      if (!(await app.passwords.verify(user.password_hash, currentPassword))) {
        await app.rateLimiter.consume(rule, userId);
        throw new HttpProblem(401, 'invalid_credentials');
      }

      const hash = await app.passwords.hash(newPassword);
      const revoked = await withTransaction(app.db, async (conn) => {
        await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
        return revokeUserSessions(conn, userId, { exceptDeviceId: deviceId });
      });

      await app.rateLimiter.reset(rule, userId);
      for (const id of revoked) disconnectDevice(app, id);
      request.log.info({ revokedDevices: revoked.length }, 'password changed');
      return reply.code(204).send();
    },
  );
}
