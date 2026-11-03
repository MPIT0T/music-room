import { HttpProblem } from '../errors.js';
import { tooManyRequests } from '../security/rate-limit.js';

/**
 * Confirms the signed-in user's current password before a sensitive change (new password,
 * new login method). A stolen access token alone must not be enough for those.
 * 409 no_password, 429 after 5 tries per 15 min, 401 invalid_credentials.
 */
export async function confirmCurrentPassword(app, userId, currentPassword) {
  const [[user]] = await app.db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!user?.password_hash) throw new HttpProblem(409, 'no_password');

  const rule = app.limits.changePassword;
  // Counted before argon2 (atomic INCR): parallel guesses cannot all pass the check
  const { allowed, retryAfter } = await app.rateLimiter.consume(rule, userId);
  if (!allowed) {
    // Refused before argon2: the count stays at the cap instead of growing with each retry
    await app.rateLimiter.refund(rule, userId);
    throw tooManyRequests(retryAfter);
  }
  if (!(await app.passwords.verify(user.password_hash, currentPassword))) {
    throw new HttpProblem(401, 'invalid_credentials');
  }
  await app.rateLimiter.reset(rule, userId);
}
