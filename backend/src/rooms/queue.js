import { withTransaction } from '../db/tx.js';
import { publicTrack } from '../tracks/repo.js';

function toItem(row) {
  return {
    id: row.id,
    track: publicTrack({
      id: row.track_id,
      title: row.title,
      artist: row.artist,
      durationMs: row.duration_ms,
      coverUrl: row.cover_url,
    }),
    addedBy: row.added_by,
    votes: Number(row.votes),
    myVote: Boolean(row.my_vote),
    createdAt: row.created_at,
  };
}

// Active items only (played ones are history). Ties on votes go to the oldest proposal.
export async function listQueue(db, roomId, userId) {
  const [rows] = await db.query(
    `SELECT rt.id, rt.status, rt.added_by, rt.created_at,
            t.id AS track_id, t.title, t.artist, t.duration_ms, t.cover_url,
            (SELECT COUNT(*) FROM votes v WHERE v.room_track_id = rt.id) AS votes,
            EXISTS (SELECT 1 FROM votes v WHERE v.room_track_id = rt.id AND v.user_id = ?) AS my_vote
       FROM room_tracks rt
       JOIN tracks t ON t.id = rt.track_id
      WHERE rt.room_id = ? AND rt.status <> 'played'
      ORDER BY votes DESC, rt.created_at ASC, rt.id ASC`,
    [userId, roomId],
  );
  const playing = rows.find((row) => row.status === 'playing');
  return {
    playing: playing ? toItem(playing) : null,
    queue: rows.filter((row) => row.status === 'queued').map(toItem),
  };
}

// One item, scoped to its room: an item id from another room is "not found"
export async function findItem(db, roomId, itemId, userId) {
  const [[row]] = await db.query(
    `SELECT rt.id, rt.status, rt.added_by, rt.created_at,
            t.id AS track_id, t.title, t.artist, t.duration_ms, t.cover_url,
            (SELECT COUNT(*) FROM votes v WHERE v.room_track_id = rt.id) AS votes,
            EXISTS (SELECT 1 FROM votes v WHERE v.room_track_id = rt.id AND v.user_id = ?) AS my_vote
       FROM room_tracks rt
       JOIN tracks t ON t.id = rt.track_id
      WHERE rt.id = ? AND rt.room_id = ?`,
    [userId, itemId, roomId],
  );
  return row ? toItem(row) : null;
}

// uq_room_active_track rejects a track already queued or playing: we return that item instead.
// Two tries, because the duplicate can turn 'played' (skip) between our INSERT and our SELECT.
export async function addTrack(db, roomId, trackId, userId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [[row]] = await db.query(
        'INSERT INTO room_tracks (room_id, track_id, added_by) VALUES (?, ?, ?) RETURNING id',
        [roomId, trackId, userId],
      );
      return { item: await findItem(db, roomId, row.id, userId), created: true };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
    const [[existing]] = await db.query(
      'SELECT id FROM room_tracks WHERE room_id = ? AND active_track_id = ?',
      [roomId, trackId],
    );
    if (existing) return { item: await findItem(db, roomId, existing.id, userId), created: false };
  }
  throw new Error('room_tracks: duplicate key without an active row');
}

// The votes primary key (room_track_id, user_id) allows one vote per user: voting twice is a no-op.
// Returns whether something changed.
export async function vote(db, itemId, userId) {
  try {
    await db.query('INSERT INTO votes (room_track_id, user_id) VALUES (?, ?)', [itemId, userId]);
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

export async function unvote(db, itemId, userId) {
  const [result] = await db.query('DELETE FROM votes WHERE room_track_id = ? AND user_id = ?', [
    itemId,
    userId,
  ]);
  return result.affectedRows > 0;
}

// Ends the playing item and starts the most voted queued one (same order as listQueue).
// Returns the new playing item id, null if the queue was empty, undefined if the room is gone.
export async function skip(db, roomId) {
  return withTransaction(db, async (conn) => {
    // Lock the room row: concurrent skips of the same room run one after the other
    const [[room]] = await conn.query('SELECT id FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    if (!room) return undefined;

    await conn.query(
      "UPDATE room_tracks SET status = 'played' WHERE room_id = ? AND status = 'playing'",
      [roomId],
    );
    const [[next]] = await conn.query(
      `SELECT rt.id
         FROM room_tracks rt
        WHERE rt.room_id = ? AND rt.status = 'queued'
        ORDER BY (SELECT COUNT(*) FROM votes v WHERE v.room_track_id = rt.id) DESC,
                 rt.created_at ASC, rt.id ASC
        LIMIT 1`,
      [roomId],
    );
    if (!next) return null;
    await conn.query("UPDATE room_tracks SET status = 'playing' WHERE id = ?", [next.id]);
    return next.id;
  });
}
