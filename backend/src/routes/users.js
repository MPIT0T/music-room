import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { dbErrorProblem } from '../db/errors.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { consumeEmailToken, issueEmailToken } from '../auth/email-tokens.js';
import { safeText } from '../validation.js';
import { rateLimit } from '../security/rate-limit.js';

const accepted = z
  .null()
  .describe('Always 202 with an empty body, whether the email exists or not');

const emailField = z.string().trim().toLowerCase().max(255).pipe(z.email());

const signupBody = z.object({
  email: emailField,
  password: z.string().min(8).max(128),
  displayName: safeText({ min: 1, max: 50 }),
});

// Exactly what issueEmailToken produces (32 bytes in base64url): anything else never reaches SQL
const verifyBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

const resendBody = z.object({ email: emailField });

// Not awaited: the answer must not depend on SMTP speed or failures.
// Only the codes are logged: SMTP error messages can quote the recipient address
function sendInBackground(request, sending, what) {
  sending.catch((err) =>
    request.log.error({ code: err.code, responseCode: err.responseCode }, `${what} email failed`),
  );
}

export default async function usersRoutes(app) {
  const signupSchema = {
    tags: ['auth'],
    summary: 'Sign up with email and password',
    description:
      'Sends a verification link, or an "already registered" notice when the email exists. ' +
      'Same answer in both cases, so the route cannot be used to test which emails have an account.',
    body: signupBody,
    response: { 202: accepted, 429: problemSchema },
  };
  const signupLimit = rateLimit(app.limits.signup, (request) => request.ip);

  app.post(
    '/v1/users',
    { schema: signupSchema, preHandler: signupLimit },
    async (request, reply) => {
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
      sendInBackground(request, sending, 'signup');

      return reply.code(202).send();
    },
  );

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
  const resendSchema = {
    tags: ['auth'],
    summary: 'Send a new verification link',
    description:
      'Always 202. At most one request per minute per email, counted whether the account ' +
      'exists or not, so neither the 202 nor the 429 tells which emails have an account.',
    body: resendBody,
    response: { 202: accepted, 429: problemSchema },
  };
  // Limited before the account lookup: an unknown email is throttled exactly like a real one
  const resendLimit = rateLimit(app.limits.resendVerification, (request) => request.body.email);

  app.post(
    '/v1/users/verify-email/resend',
    { schema: resendSchema, preHandler: resendLimit },
    async (request, reply) => {
      const { email } = request.body;
      const [[user]] = await app.db.query(
        'SELECT id, display_name FROM users WHERE email = ? AND email_verified_at IS NULL',
        [email],
      );
      // Unverified account: one extra write (about 1 ms) that the 1/min limit keeps from being measured
      if (user) {
        const token = await withTransaction(app.db, (conn) =>
          issueEmailToken(conn, user.id, 'verify_email'),
        );
        sendInBackground(
          request,
          app.mailer.sendVerifyEmail(email, { displayName: user.display_name, token }),
          'resend',
        );
      }
      return reply.code(202).send();
    },
  );
}
