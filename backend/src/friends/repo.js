export async function areFriends(db, userId, otherId) {
  if (userId === otherId) {
    return false; // Can't be friends with yourself
  }
  const [rows] = await db.query(
    `SELECT 1 FROM friendships
      WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
        AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))
        AND status = 'accepted'`,
    [userId, otherId, userId, otherId],
  );
  return rows.length > 0;
}

export async function requestOrAccept(conn, userId, otherId) {
  await conn.query(
    `INSERT INTO friendships (user_a, user_b, requested_by)
      VALUES (LEAST(CAST(? AS UUID), CAST(? AS UUID)), GREATEST(CAST(? AS UUID), CAST(? AS UUID)), ?)
      ON DUPLICATE KEY UPDATE status = IF(requested_by <> VALUES(requested_by), 'accepted', status)`,
    [userId, otherId, userId, otherId, userId],
  );
  const [[row]] = await conn.query(
    `SELECT status from friendships
      WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
        AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))`,
    [userId, otherId, userId, otherId],
  );
  return row.status; // row exists because first request either created or verified existence of a row
}

export async function removeFriendship(conn, userId, otherId) {
  const [result] = await conn.query(
    `DELETE FROM friendships
      WHERE user_a = LEAST(CAST(? AS UUID), CAST(? AS UUID))
        AND user_b = GREATEST(CAST(? AS UUID), CAST(? AS UUID))`,
    [userId, otherId, userId, otherId],
  );
  if (result.affectedRows === 0) {
    return false;
  }
  await conn.query(
    `DELETE cd from control_delegations cd
      JOIN devices d ON d.id = cd.device_id
      WHERE (d.user_id = ? AND cd.delegate_user_id = ?)
        OR (d.user_id = ? AND cd.delegate_user_id = ?)`,
    [userId, otherId, otherId, userId],
  );
}
