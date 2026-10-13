import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { openSession } from '../auth/sessions.js';
import { findUserByEmail, toPublicUser } from '../users/repo.js';
import { emailField, safeText } from '../validation.js';
import { tooManyRequests } from '../security/rate-limit.js';

const deviceBody = z.object({
  name: safeText({ min: 1, max: 100 }),
  platform: z.enum(['android', 'ios', 'web']),
  model: safeText({ max: 100 }).optional(),
  appVersion: safeText({ max: 20 }).optional(),
});

const loginBody = z.object({
  email: emailField,
  password: z.string().min(1).max(128),
  device: deviceBody,
  deviceId: z.uuid().nullish(),
});

// Response schemas also filter: a field not listed here (password_hash...) can never be sent
const userSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  plan: z.enum(['free', 'premium']),
  providers: z.array(z.string()),
});

export const sessionSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string(),
  refreshTokenExpiresIn: z.number().int(),
  deviceId: z.string(),
  user: userSchema,
});

export default async function sessionsRoutes(app) {
  const loginSchema = {
    tags: ['auth'],
    summary: 'Log in with email and password',
    description:
      'Unknown email, wrong password and Google-only account give the same 401, in the same time. ' +
      'email_not_verified only comes after a correct password. Failures are limited per IP + email ' +
      'and per IP, checked before the password.',
    body: loginBody,
    response: { 200: sessionSchema, 401: problemSchema, 403: problemSchema, 429: problemSchema },
  };

  app.post('/v1/sessions', { schema: loginSchema }, async (request) => {
    const { email, password, device, deviceId } = request.body;
    const { login, loginIp } = app.limits;
    const pair = `${request.ip}|${email}`;

    // Checked before the password: once the limit is hit, even the right password is refused
    for (const [rule, value] of [
      [login, pair],
      [loginIp, request.ip],
    ]) {
      const { allowed, retryAfter } = await app.rateLimiter.peek(rule, value);
      if (!allowed) throw tooManyRequests(retryAfter);
    }

    const user = await findUserByEmail(app.db, email);
    // No hash (unknown email, Google-only account): a dummy hash is verified, same cost
    if (!(await app.passwords.verify(user?.password_hash ?? null, password))) {
      await Promise.all([
        app.rateLimiter.consume(login, pair),
        app.rateLimiter.consume(loginIp, request.ip),
      ]);
      throw new HttpProblem(401, 'invalid_credentials');
    }
    if (!user.email_verified_at) throw new HttpProblem(403, 'email_not_verified');

    await app.rateLimiter.reset(login, pair);
    const session = await withTransaction(app.db, (conn) =>
      openSession(conn, app.tokens, { userId: user.id, device, deviceId }),
    );
    return { ...session, user: toPublicUser(user) };
  });
}
