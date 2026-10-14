import { createHash, randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_TTL_SECONDS } from './tokens.js';

export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Two refreshes sent at the same time by the app are a client bug, not a theft
export const REFRESH_GRACE_SECONDS = 10;

// Only the hash is stored: a leaked devices table gives no usable refresh token
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function newRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

async function sessionFor(tokens, { userId, deviceId, refreshToken }) {
  return {
    accessToken: await tokens.signAccessToken({ userId, deviceId }),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    deviceId,
  };
}

// Opens a session on a device: reuses the user's own row when deviceId points to one
// (contract "Champ deviceId"), otherwise creates a device. Runs inside a transaction.
export async function openSession(conn, tokens, { userId, device, deviceId }) {
  const refresh = newRefreshToken();
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
      [...fields, refresh.hash, REFRESH_TOKEN_TTL_SECONDS, deviceId, userId],
    );
    if (result.affectedRows === 1) id = deviceId;
  }
  if (!id) {
    const [[row]] = await conn.query(
      `INSERT INTO devices
         (id, user_id, name, platform, model, app_version, refresh_hash, refresh_expires_at, last_seen_at)
       VALUES (uuid_v7(), ?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ? SECOND, NOW(3))
       RETURNING id`,
      [userId, ...fields, refresh.hash, REFRESH_TOKEN_TTL_SECONDS],
    );
    id = row.id;
  }

  return sessionFor(tokens, { userId, deviceId: id, refreshToken: refresh.token });
}

/**
 * Rotates a refresh token. Runs inside a transaction and returns an outcome instead of
 * throwing: the "reused" revocation must be committed, a throw would roll it back.
 * - rotated: new session; the old token is kept as previous_refresh_hash
 * - conflict: the previous token, replayed within the grace window
 * - reused: the previous token, replayed later: the device's session is revoked
 * - invalid: unknown, expired or revoked
 */
export async function rotateSession(conn, tokens, refreshToken) {
  const hash = sha256(refreshToken);
  // FOR UPDATE: two concurrent refreshes with the same token are serialized, the second
  // one sees the first one's rotation. Times are compared in SQL, on the database clock.
  const [[row]] = await conn.query(
    `SELECT id, user_id,
            refresh_hash = ? AS is_current,
            refresh_expires_at > NOW(3) AS is_live,
            rotated_at > NOW(3) - INTERVAL ? SECOND AS in_grace
     FROM devices
     WHERE refresh_hash = ? OR previous_refresh_hash = ?
     LIMIT 1
     FOR UPDATE`,
    [hash, REFRESH_GRACE_SECONDS, hash, hash],
  );
  if (!row) return { outcome: 'invalid' };
  const ids = { userId: row.user_id, deviceId: row.id };

  if (!row.is_current) {
    if (row.in_grace) return { outcome: 'conflict', ...ids };
    await clearRefresh(conn, ids);
    return { outcome: 'reused', ...ids };
  }
  if (!row.is_live) return { outcome: 'invalid' };

  const refresh = newRefreshToken();
  await conn.query(
    `UPDATE devices
     SET previous_refresh_hash = refresh_hash, refresh_hash = ?, rotated_at = NOW(3),
         refresh_expires_at = NOW(3) + INTERVAL ? SECOND, last_seen_at = NOW(3)
     WHERE id = ?`,
    [refresh.hash, REFRESH_TOKEN_TTL_SECONDS, row.id],
  );
  return {
    outcome: 'rotated',
    ...ids,
    session: await sessionFor(tokens, { ...ids, refreshToken: refresh.token }),
  };
}

// Logout and theft detection. The devices row stays: control_delegations cascade on it.
export async function clearRefresh(db, { userId, deviceId }) {
  await db.query(
    `UPDATE devices
     SET refresh_hash = NULL, previous_refresh_hash = NULL, refresh_expires_at = NULL, rotated_at = NULL
     WHERE id = ? AND user_id = ?`,
    [deviceId, userId],
  );
}
