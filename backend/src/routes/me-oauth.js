import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { verifyGoogleIdToken } from '../auth/google.js';
import { loadMe } from '../users/profile.js';
import { meSchema } from './me.js';

const linkBody = z.object({ idToken: z.string().min(1).max(4096) });

// Returns an outcome instead of throwing, like the sign-in: the caller maps it to a status
async function linkGoogle(conn, userId, sub) {
  const [[owner]] = await conn.query(
    "SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?",
    [sub],
  );
  if (owner) return owner.user_id === userId ? 'linked' : 'in_use';

  // FOR UPDATE: two link requests for this user are serialized
  const [[current]] = await conn.query(
    "SELECT provider_user_id FROM oauth_accounts WHERE user_id = ? AND provider = 'google' FOR UPDATE",
    [userId],
  );
  if (current) return 'already_linked';

  await conn.query(
    "INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', ?)",
    [userId, sub],
  );
  return 'linked';
}

export default async function meOauthRoutes(app) {
  app.addHook('onRequest', requireAuth);

  async function me(userId) {
    const result = await loadMe(app.db, userId);
    if (!result) throw new HttpProblem(401, 'unauthorized');
    return result;
  }

  app.put(
    '/v1/me/oauth/google',
    {
      schema: {
        tags: ['profile'],
        summary: 'Link a Google account to my account',
        description:
          'The Google email may differ from the account email. Idempotent: linking the same ' +
          'Google account again is a 200. 409 already_linked: another Google account is linked ' +
          '(unlink it first). 409 oauth_account_in_use: this Google account belongs to another user.',
        security: [{ bearerAuth: [] }],
        body: linkBody,
        response: {
          200: meSchema,
          401: problemSchema,
          409: problemSchema,
          503: problemSchema,
        },
      },
    },
    async (request) => {
      const claims = await verifyGoogleIdToken(app, request, request.body.idToken);

      let outcome;
      for (let attempt = 1; ; attempt++) {
        try {
          outcome = await withTransaction(app.db, (conn) =>
            linkGoogle(conn, request.userId, claims.sub),
          );
          break;
        } catch (err) {
          // Two links raced on a unique key: the replay reads who won and answers accordingly
          if (attempt >= 2 || err.errno !== 1062) throw err;
        }
      }
      if (outcome === 'in_use') throw new HttpProblem(409, 'oauth_account_in_use');
      if (outcome === 'already_linked') throw new HttpProblem(409, 'already_linked');

      request.log.info({ aud: claims.aud, azp: claims.azp }, 'google account linked');
      return me(request.userId);
    },
  );

  app.delete(
    '/v1/me/oauth/google',
    {
      schema: {
        tags: ['profile'],
        summary: 'Unlink my Google account',
        description:
          '409 last_login_method when the account has no password: unlinking would leave no way ' +
          'to sign in. Set a password first with POST /v1/password-resets.',
        security: [{ bearerAuth: [] }],
        response: { 200: meSchema, 401: problemSchema, 404: problemSchema, 409: problemSchema },
      },
    },
    async (request) => {
      const outcome = await withTransaction(app.db, async (conn) => {
        // Locked together: a password reset cannot land between the check and the delete
        const [[user]] = await conn.query(
          `SELECT u.password_hash IS NOT NULL AS has_password,
                  EXISTS(SELECT 1 FROM oauth_accounts o
                         WHERE o.user_id = u.id AND o.provider = 'google') AS has_google
           FROM users u WHERE u.id = ? FOR UPDATE`,
          [request.userId],
        );
        if (!user?.has_google) return 'not_linked';
        if (!user.has_password) return 'last_login_method';
        await conn.query("DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'google'", [
          request.userId,
        ]);
        return 'unlinked';
      });
      if (outcome === 'not_linked') throw new HttpProblem(404, 'not_linked');
      if (outcome === 'last_login_method') throw new HttpProblem(409, 'last_login_method');

      request.log.info('google account unlinked');
      return me(request.userId);
    },
  );
}
