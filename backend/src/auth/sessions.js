import { createHash, randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_TTL_SECONDS } from './tokens.js';

export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

// Only the hash is stored: a leaked devices table gives no usable refresh token
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Opens a session on a device: reuses the user's own row when deviceId points to one
// (contract "Champ deviceId"), otherwise creates a device. Runs inside a transaction.
export async function openSession(conn, tokens, { userId, device, deviceId }) {
  const refreshToken = randomBytes(32).toString('base64url');
  const fields = [device.name, device.platform, device.model ?? null, device.appVersion ?? null];

  let id = null;
  if (deviceId) {
    // user_id in the WHERE: another user's id is silently ignored, nothing to reveal.
    // previous_refresh_hash is cleared, not set to the old token: a late refresh with it
    // must look like an unknown token, not like a stolen one (that would revoke this session)
    const [result] = await conn.query(
      `UPDATE devices
       SET name = ?, platform = ?, model = ?, app_version = ?,
           refresh_hash = ?, previous_refresh_hash = NULL, rotated_at = NULL,
           refresh_expires_at = NOW(3) + INTERVAL ? SECOND, last_seen_at = NOW(3)
       WHERE id = ? AND user_id = ?`,
      [...fields, sha256(refreshToken), REFRESH_TOKEN_TTL_SECONDS, deviceId, userId],
    );
    if (result.affectedRows === 1) id = deviceId;
  }
  if (!id) {
    const [[row]] = await conn.query(
      `INSERT INTO devices
         (id, user_id, name, platform, model, app_version, refresh_hash, refresh_expires_at, last_seen_at)
       VALUES (uuid_v7(), ?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ? SECOND, NOW(3))
       RETURNING id`,
      [userId, ...fields, sha256(refreshToken), REFRESH_TOKEN_TTL_SECONDS],
    );
    id = row.id;
  }

  return {
    accessToken: await tokens.signAccessToken({ userId, deviceId: id }),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    deviceId: id,
  };
}
