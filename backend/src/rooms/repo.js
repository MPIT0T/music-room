export function toRoom(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    accessPolicy: row.access_policy,
    window: row.starts_at == null ? null : { start: row.starts_at, end: row.ends_at },
    // DECIMAL columns come back as strings
    place:
      row.latitude == null
        ? null
        : { lat: Number(row.latitude), lng: Number(row.longitude), radiusM: row.radius_m },
    beaconMinor: row.beacon_minor,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

// A beacon talks to anyone nearby: it only ever reveals a public room
export async function findRoomByBeacon(db, beaconMinor) {
  const [rows] = await db.query(
    "SELECT * FROM rooms WHERE beacon_minor = ? AND visibility = 'public'",
    [beaconMinor],
  );
  return rows.length === 0 ? null : toRoom(rows[0]);
}

// What the user can find: public rooms, and private ones they own or were invited to
export async function listVisibleRooms(db, userId, limit) {
  const [rows] = await db.query(
    `SELECT r.*
       FROM rooms r
      WHERE r.visibility = 'public'
         OR r.owner_id = ?
         OR EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`,
    [userId, userId, limit],
  );
  return rows.map(toRoom);
}

export async function insertRoom(db, ownerId, input) {
  const [rows] = await db.query(
    `INSERT INTO rooms (owner_id, name, description, visibility, access_policy, starts_at, ends_at,
                        latitude, longitude, radius_m, beacon_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      ownerId,
      input.name,
      input.description,
      input.visibility,
      input.accessPolicy,
      input.window?.start ?? null,
      input.window?.end ?? null,
      input.place?.lat ?? null,
      input.place?.lng ?? null,
      input.place?.radiusM ?? null,
      input.beaconMinor,
    ],
  );
  return toRoom(rows[0]);
}

export async function updateRoom(db, roomId, expectedVersion, room) {
  const [result] = await db.query(
    `UPDATE rooms
        SET name = ?, description = ?, visibility = ?, access_policy = ?,
            starts_at = ?, ends_at = ?, latitude = ?, longitude = ?, radius_m = ?,
            beacon_minor = ?, version = version + 1
      WHERE id = ? AND version = ?`,
    [
      room.name,
      room.description,
      room.visibility,
      room.accessPolicy,
      room.window?.start ?? null,
      room.window?.end ?? null,
      room.place?.lat ?? null,
      room.place?.lng ?? null,
      room.place?.radiusM ?? null,
      room.beaconMinor,
      roomId,
      expectedVersion,
    ],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
  return toRoom(rows[0]);
}

export async function deleteRoom(db, roomId, ownerId) {
  const [result] = await db.query('DELETE FROM rooms WHERE id = ? AND owner_id = ?', [
    roomId,
    ownerId,
  ]);
  return result.affectedRows > 0;
}

export async function listMembers(db, roomId) {
  const [rows] = await db.query(
    `SELECT u.id, u.display_name, rm.joined_at
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY rm.joined_at, u.id`,
    [roomId],
  );
  return rows.map((row) => ({
    userId: row.id,
    displayName: row.display_name,
    joinedAt: row.joined_at,
  }));
}

export async function addMember(db, roomId, userId) {
  try {
    await db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [roomId, userId]);
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

export async function removeMember(db, roomId, userId) {
  const [result] = await db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [
    roomId,
    userId,
  ]);
  return result.affectedRows > 0;
}
