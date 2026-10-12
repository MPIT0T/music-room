import { createHash, randomBytes } from 'node:crypto';

const TTL_SECONDS = { verify_email: 24 * 60 * 60, reset_password: 60 * 60 };

// Only the hash is stored: a leaked email_tokens table gives no usable link
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function issueEmailToken(conn, userId, type) {
  const token = randomBytes(32).toString('base64url');
  // One live link per user and type: a new one revokes the previous
  await conn.query('DELETE FROM email_tokens WHERE user_id = ? AND type = ?', [userId, type]);
  await conn.query(
    'INSERT INTO email_tokens (token_hash, user_id, type, expires_at) VALUES (?, ?, ?, NOW(3) + INTERVAL ? SECOND)',
    [sha256(token), userId, type, TTL_SECONDS[type]],
  );
  return token;
}

// Returns the user id, or null for an unknown, expired or already used token
export async function consumeEmailToken(conn, token, type) {
  // DELETE ... RETURNING in one statement: single use, even if two requests race
  const [rows] = await conn.query(
    'DELETE FROM email_tokens WHERE token_hash = ? AND type = ? RETURNING user_id, expires_at > NOW(3) AS valid',
    [sha256(token), type],
  );
  return rows[0]?.valid ? rows[0].user_id : null;
}
