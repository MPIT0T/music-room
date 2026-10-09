import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { dbErrorProblem } from '../db/errors.js';
import { HttpProblem } from '../errors.js';
import { consumeEmailToken, issueEmailToken } from '../auth/email-tokens.js';
import { safeText } from '../validation.js';

const accepted = z
  .null()
  .describe('Always 202 with an empty body, whether the email exists or not');

const signupBody = z.object({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
  password: z.string().min(8).max(128),
  displayName: safeText({ min: 1, max: 50 }),
});

// Exactly what issueEmailToken produces (32 bytes in base64url): anything else never reaches SQL
const verifyBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export default async function usersRoutes(app) {
  const signupSchema = {
    tags: ['auth'],
    summary: 'Sign up with email and password',
    description:
      'Sends a verification link, or an "already registered" notice when the email exists. ' +
      'Same answer in both cases, so the route cannot be used to test which emails have an account.',
    body: signupBody,
    response: { 202: accepted },
  };

  app.post('/v1/users', { schema: signupSchema }, async (request, reply) => {
    const { email, password, displayName } = request.body;
    // Hashed even when the email exists: it is the slow part, so both answers take as long
    const passwordHash = await app.passwords.hash(password);

    let token;
    try {
      token = await withTransaction(app.db, async (conn) => {
        const [[user]] = await conn.query(
          'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id',
          [email, passwordHash, displayName],
        );
        return issueEmailToken(conn, user.id, 'verify_email');
      });
    } catch (err) {
      // Left to the global handler this would be "409 email_taken": anyone could test addresses
      if (dbErrorProblem(err)?.code !== 'email_taken') throw err;
    }

    const sending = token
      ? app.mailer.sendVerifyEmail(email, { displayName, token })
      : app.mailer.sendAlreadyRegistered(email);
    // Not awaited: the answer must not depend on SMTP speed or failures.
    // Only the codes are logged: SMTP error messages can quote the recipient address
    sending.catch((err) =>
      request.log.error({ code: err.code, responseCode: err.responseCode }, 'signup email failed'),
    );

    return reply.code(202).send();
  });

  const verifySchema = {
    tags: ['auth'],
    summary: 'Confirm an email address with the token from the email link',
    description: 'Single use. Unknown, expired or already used token: 400 invalid_token.',
    body: verifyBody,
    response: { 204: z.null().describe('Email verified') },
  };

  app.post('/v1/users/verify-email', { schema: verifySchema }, async (request, reply) => {
    const verified = await withTransaction(app.db, async (conn) => {
      const userId = await consumeEmailToken(conn, request.body.token, 'verify_email');
      if (!userId) return false;
      await conn.query(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW(3)) WHERE id = ?',
        [userId],
      );
      return true;
    });
    if (!verified) throw new HttpProblem(400, 'invalid_token');
    return reply.code(204).send();
  });
}
