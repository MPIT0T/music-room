import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { clearRefresh, openSession, rotateSession } from '../auth/sessions.js';
import { requireAuth } from '../auth/guards.js';
import { isGoogleUnavailable } from '../auth/google.js';
import { signInWithGoogle } from '../users/oauth.js';
import { disconnectDevice } from '../auth/sockets.js';
import { findUserByEmail, findUserById, toPublicUser } from '../users/repo.js';
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

// provider is checked in the handler: the contract wants unsupported_provider, not validation_failed
const oauthBody = z.object({
  provider: z.string().max(20),
  idToken: z.string().min(1).max(4096),
  device: deviceBody,
  deviceId: z.uuid().nullish(),
});

// 32 random bytes in base64url: anything else cannot be one of our tokens
const refreshBody = z.object({
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
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

  const oauthSchema = {
    tags: ['auth'],
    summary: 'Sign in with a Google ID token',
    description:
      'The ID token comes from google_sign_in (serverClientId = web client). 200 for an existing ' +
      'account, 201 when the account is created. A local account with the same verified email is ' +
      'linked; if its email was never verified, its password is removed (pre-hijacking).',
    body: oauthBody,
    response: {
      200: sessionSchema,
      201: sessionSchema,
      400: problemSchema,
      401: problemSchema,
      403: problemSchema,
      409: problemSchema,
      503: problemSchema,
    },
  };

  app.post('/v1/sessions/oauth', { schema: oauthSchema }, async (request, reply) => {
    const { provider, idToken, device, deviceId } = request.body;
    if (provider !== 'google') throw new HttpProblem(400, 'unsupported_provider');
    if (!app.googleVerifier.configured) throw new HttpProblem(503, 'oauth_unavailable');

    let claims;
    try {
      claims = await app.googleVerifier.verify(idToken);
    } catch (err) {
      // Only the reason is logged: the ID token is a bearer credential for its lifetime
      if (isGoogleUnavailable(err)) {
        request.log.warn({ reason: err.code ?? err.name }, 'google keys unavailable');
        throw new HttpProblem(503, 'oauth_unavailable');
      }
      request.log.info({ reason: err.code, claim: err.claim }, 'google id token rejected');
      throw new HttpProblem(401, 'invalid_oauth_token');
    }

    const result = await signInOnce(claims, { device, deviceId });
    if (result.outcome === 'email_not_verified') {
      throw new HttpProblem(403, 'oauth_email_not_verified');
    }
    if (result.outcome === 'already_linked') throw new HttpProblem(409, 'already_linked');

    // aud and azp show which client (web, Android) asked: enough to debug a misconfigured app
    request.log.info(
      { aud: claims.aud, azp: claims.azp, outcome: result.outcome, userId: result.userId },
      'google sign-in',
    );
    reply.code(result.outcome === 'created' ? 201 : 200);
    return { ...result.session, user: toPublicUser(result.user) };
  });

  async function signInOnce(claims, { device, deviceId }) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await withTransaction(app.db, async (conn) => {
          const account = await signInWithGoogle(conn, claims);
          if (!account.userId) return account;
          const session = await openSession(conn, app.tokens, {
            userId: account.userId,
            device,
            deviceId,
          });
          return { ...account, session, user: await findUserById(conn, account.userId) };
        });
      } catch (err) {
        // Two first sign-ins with the same Google account raced (duplicate email or link):
        // the replay finds the account the other one created and logs in
        if (attempt >= 2 || err.errno !== 1062) throw err;
      }
    }
  }

  const refreshSchema = {
    tags: ['auth'],
    summary: 'Exchange a refresh token for a new session',
    description:
      'The refresh token is rotated: the old one stops working. Replaying the previous token ' +
      'within 10 s gives 409 refresh_conflict (two concurrent refreshes); later, it is treated ' +
      'as a theft: 401 refresh_token_reused and the session of that device is revoked.',
    body: refreshBody,
    response: { 200: sessionSchema, 401: problemSchema, 409: problemSchema },
  };

  app.post('/v1/sessions/refresh', { schema: refreshSchema }, async (request) => {
    const result = await withTransaction(app.db, async (conn) => {
      const rotation = await rotateSession(conn, app.tokens, request.body.refreshToken);
      // Same transaction: the device row is locked, the account cannot vanish in between
      if (rotation.outcome === 'rotated') rotation.user = await findUserById(conn, rotation.userId);
      return rotation;
    });

    if (result.outcome === 'invalid') throw new HttpProblem(401, 'invalid_refresh_token');
    if (result.outcome === 'conflict') throw new HttpProblem(409, 'refresh_conflict');
    if (result.outcome === 'reused') {
      // After the commit: withTransaction may replay its function, side effects go here
      disconnectDevice(app, result.deviceId);
      request.log.warn(
        { userId: result.userId, deviceId: result.deviceId },
        'refresh token reused, device session revoked',
      );
      throw new HttpProblem(401, 'refresh_token_reused');
    }

    return { ...result.session, user: toPublicUser(result.user) };
  });

  const logoutSchema = {
    tags: ['auth'],
    summary: 'Log out this device',
    description:
      'Revokes the refresh token of the device in the access token and closes its sockets. ' +
      'The device stays listed. The access token itself stays valid until it expires (15 min). ' +
      'Idempotent.',
    security: [{ bearerAuth: [] }],
    response: { 204: z.null(), 401: problemSchema },
  };

  app.delete(
    '/v1/sessions/current',
    { schema: logoutSchema, onRequest: requireAuth },
    async (request, reply) => {
      await clearRefresh(app.db, { userId: request.userId, deviceId: request.deviceId });
      disconnectDevice(app, request.deviceId);
      return reply.code(204).send();
    },
  );
}
