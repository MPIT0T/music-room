export function toRoom(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    accessPolicy: row.access_policy,
    window: row.starts_at == null ? null : { start: row.starts_at, end: row.ends_at },
    beaconMinor: row.beacon_minor,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The room plus whether userId is invited (has a room_members row), in one query.
// Returns null when the room does not exist.
export async function findRoomForUser(db, roomId, userId) {
  const [rows] = await db.query(
    `SELECT r.*, (rm.user_id IS NOT NULL) AS is_invited
       FROM rooms r
       LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
      WHERE r.id = ?`,
    [userId, roomId],
  );
  if (rows.length === 0) return null;
  return { room: toRoom(rows[0]), isInvited: Boolean(rows[0].is_invited) };
}
