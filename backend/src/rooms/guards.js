import { z } from 'zod';
import { canView, roleOf } from './access.js';
import { findRoomForUser } from './repo.js';

export const roomIdSchema = z.uuid();

export async function loadVisibleRoom(db, roomId, userId) {
  if (!roomIdSchema.safeParse(roomId).success) return null;
  const found = await findRoomForUser(db, roomId, userId);
  if (found == null) return null;
  const role = roleOf(found.room, userId, found.isInvited);
  if (!canView(found.room, role)) return null;
  return { room: found.room, role };
}
