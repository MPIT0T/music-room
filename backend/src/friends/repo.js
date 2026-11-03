export async function areFriends(db, userId, otherId) {
  if (userId === otherId) {
    return false; // Can't be friends with yourself
  }
  const [rows] = await db.query(
    `
    SELECT 1 FROM friendships
    WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
      AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))
      AND status = 'accepted'`,
    [userId, otherId, userId, otherId],
  );
  return rows.length > 0;
}

export async function requestOrAccept(conn, userId, otherId) {
  await conn.query(
    `
    INSERT INTO friendships (user_a, user_b, requested_by)
      VALUES (LEAST(CAST(? AS UUID), CAST(? AS UUID)), GREATEST(CAST(? AS UUID), CAST(? AS UUID)), ?)
      ON DUPLICATE KEY UPDATE status = IF(requested_by <> VALUES(requested_by), 'accepted', status)`,
    [userId, otherId, userId, otherId, userId],
  );
  const [[row]] = await conn.query(
    `
    SELECT status from friendships
    WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
      AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))`,
    [userId, otherId, userId, otherId],
  );
  return row.status; // row exists because first request either created or verified existence of a row
}

export async function removeFriendship(conn, userId, otherId) {
  const [result] = await conn.query(
    `
    DELETE FROM friendships
    WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
      AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))`,
    [userId, otherId, userId, otherId],
  );
  if (result.affectedRows === 0) {
    return false;
  }
  await conn.query(
    `
    DELETE cd from control_delegations cd
      JOIN devices d ON d.id = cd.device_id
    WHERE (d.user_id = ? AND cd.delegate_user_id = ?)
      OR (d.user_id = ? AND cd.delegate_user_id = ?)`,
    [userId, otherId, otherId, userId],
  );
  return true;
}

function toUserSummary(row) {
  return { userId: row.id, displayName: row.display_name, avatarUrl: row.avatar_url };
}

export async function listFriends(db, userId) {
  const [rows] = await db.query(
    `
    SELECT u.id, u.display_name, u.avatar_url
      FROM friendships f
      JOIN users u ON u.id = IF(f.user_a = ?, f.user_b, f.user_a)
    WHERE f.status = 'accepted' AND (f.user_a = ? OR f.user_b = ?)
    ORDER BY u.display_name, u.id`,
    [userId, userId, userId],
  );
  return rows.map(toUserSummary);
}

export async function listRequests(db, userId) {
  const [rows] = await db.query(
    `
    SELECT u.id, u.display_name, u.avatar_url, f.requested_by, f.created_at
      FROM friendships f
      JOIN users u ON u.id = IF(f.user_a = ?, f.user_b, f.user_a)
    WHERE f.status = 'pending' AND (f.user_a = ? OR f.user_b = ?)
    ORDER BY f.created_at DESC`,
    [userId, userId, userId],
  );
  const toRequest = (row) => ({ ...toUserSummary(row), createdAt: row.created_at });
  return {
    incoming: rows.filter((row) => row.requested_by !== userId).map(toRequest),
    outgoing: rows.filter((row) => row.requested_by === userId).map(toRequest),
  };
}

export async function searchUsers(db, userId, text, limit) {
  const pattern = text.replace(/[\\%_]/g, '\\$&') + '%';
  const [rows] = await db.query(
    `
    SELECT u.id, u.display_name, u.avatar_url, f.status, f.requested_by
      FROM users u
      LEFT JOIN friendships f
        ON f.user_a = LEAST(u.id, CAST(? AS UUID))
        AND f.user_b = GREATEST(u.id, CAST(? AS UUID))
    WHERE u.display_name LIKE ?
      AND u.id <> ?
      AND u.email_verified_at IS NOT NULL
    ORDER BY u.display_name, u.id
    LIMIT ?`,
    [userId, userId, pattern, userId, limit],
  );
  return rows.map((row) => ({ ...toUserSummary(row), friendship: friendshipOf(row, userId) }));
}

function friendshipOf(row, userId) {
  if (row.status == null) return 'none';
  if (row.status === 'accepted') return 'accepted';
  return row.requested_by === userId ? 'outgoing' : 'incoming';
}
