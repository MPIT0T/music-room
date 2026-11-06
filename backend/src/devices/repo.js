function toDevice(row) {
  return {
    id: row.id,
    ownerId: row.user_id,
    name: row.name,
    platform: row.platform,
    model: row.model,
    appVersion: row.app_version,
    signedIn: Boolean(row.signed_in),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export async function listDevices(db, userId) {
  const [rows] = await db.query(
    `SELECT id, user_id, name, platform, model, app_version,
            refresh_hash IS NOT NULL AS signed_in, last_seen_at, created_at
       FROM devices WHERE user_id = ?
      ORDER BY last_seen_at DESC, created_at DESC`,
    [userId],
  );
  return rows.map(toDevice);
}

export async function findDevice(db, deviceId) {
  const [[row]] = await db.query(
    `SELECT id, user_id, name, platform, model, app_version,
            refresh_hash IS NOT NULL AS signed_in, last_seen_at, created_at
       FROM devices WHERE id = ?`,
    [deviceId],
  );
  return row ? toDevice(row) : null;
}

export async function renameDevice(db, deviceId, userId, name) {
  const [result] = await db.query('UPDATE devices SET name = ? WHERE id = ? AND user_id = ?', [
    name,
    deviceId,
    userId,
  ]);
  return result.affectedRows === 1;
}

function toDelegation(row) {
  return {
    deviceId: row.device_id,
    delegateId: row.delegate_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function findDelegation(db, deviceId, userId) {
  const [[row]] = await db.query(
    `SELECT device_id, delegate_user_id, expires_at, created_at
       FROM control_delegations WHERE device_id = ? AND delegate_user_id = ?`,
    [deviceId, userId],
  );
  return row ? toDelegation(row) : null;
}

export async function listDeviceDelegations(db, deviceId) {
  const [rows] = await db.query(
    `SELECT cd.device_id, cd.delegate_user_id, cd.expires_at, cd.created_at,
            u.display_name, u.avatar_url
       FROM control_delegations cd
       JOIN users u ON u.id = cd.delegate_user_id
      WHERE cd.device_id = ?
      ORDER BY u.display_name, u.id`,
    [deviceId],
  );
  return rows.map((row) => ({
    userId: row.delegate_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function upsertDelegation(conn, deviceId, delegateId, expiresAt) {
  await conn.query(
    `INSERT INTO control_delegations (device_id, delegate_user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [deviceId, delegateId, expiresAt],
  );
  return findDelegation(conn, deviceId, delegateId);
}

export async function deleteDelegation(db, deviceId, delegateId) {
  const [result] = await db.query(
    'DELETE FROM control_delegations WHERE device_id = ? AND delegate_user_id = ?',
    [deviceId, delegateId],
  );
  return result.affectedRows > 0;
}

export async function listDelegatedToMe(db, userId) {
  const [rows] = await db.query(
    `SELECT cd.device_id, cd.expires_at, d.name AS device_name,
            u.id AS owner_id, u.display_name, u.avatar_url
       FROM control_delegations cd
       JOIN devices d ON d.id = cd.device_id
       JOIN users u ON u.id = d.user_id
      WHERE cd.delegate_user_id = ?
        AND (cd.expires_at IS NULL OR cd.expires_at > NOW(3))
      ORDER BY u.display_name, d.name, d.id`,
    [userId],
  );
  return rows.map((row) => ({
    deviceId: row.device_id,
    deviceName: row.device_name,
    owner: { userId: row.owner_id, displayName: row.display_name, avatarUrl: row.avatar_url },
    expiresAt: row.expires_at,
  }));
}
