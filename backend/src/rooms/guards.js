import { z } from 'zod';
import { canView, roleOf } from './access.js';
import { findRoomForUser } from './repo.js';

export const roomIdSchema = z.uuid();

// Loads a room the user is allowed to see, with their role in it.
// Returns null for a malformed id, an unknown room AND a private room the user is not part of:
// callers answer 404 in all three cases, so a private room's existence never leaks.
export async function loadVisibleRoom(db, roomId, userId) {
  if (!roomIdSchema.safeParse(roomId).success) return null;

  const found = await findRoomForUser(db, roomId, userId);
  if (found == null) return null;

  const role = roleOf(found.room, userId, found.isInvited);
  if (!canView(found.room, role)) return null;

  return { room: found.room, role };
}
