import { z } from 'zod';
import { HttpProblem } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { canManage, canRemoveMember } from '../rooms/access.js';
import { emitRoomChanged, removeUserFromChannel } from '../rooms/events.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import { addMember, listMembers, removeMember } from '../rooms/repo.js';
import { memberParams, membersResponse, roomParams } from '../rooms/schemas.js';

export default async function roomMembersRoutes(app) {
  app.addHook('onRequest', requireAuth);

  async function visibleRoomOr404(request) {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    return visible;
  }

  const listSchema = {
    tags: ['rooms'],
    summary: 'List the invited members of a room',
    description:
      'Anyone who can see the room. The owner is not in the list (see ownerId on the room). ' +
      'A private room answers 404 to anyone who is neither owner nor member.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: membersResponse },
  };

  app.get('/v1/rooms/:id/members', { schema: listSchema }, async (request) => {
    const { room } = await visibleRoomOr404(request);
    return { members: await listMembers(app.db, room.id) };
  });

  const putSchema = {
    tags: ['rooms'],
    summary: 'Invite a user to a room',
    description:
      'Owner only, idempotent: inviting someone already invited changes nothing. Any user can ' +
      'be invited by id, friend or not. 404 user_not_found for an unknown user, 409 is_owner ' +
      'for the owner. Subscribers receive `room.changed` with `change: "members"`.',
    security: [{ bearerAuth: [] }],
    params: memberParams,
    response: { 204: z.null().describe('The user is a member') },
  };

  app.put('/v1/rooms/:id/members/:userId', { schema: putSchema }, async (request, reply) => {
    const { room, role } = await visibleRoomOr404(request);
    if (!canManage(room, role)) throw new HttpProblem(403, 'forbidden');
    const { userId } = request.params;
    if (userId === room.ownerId) {
      throw new HttpProblem(409, 'is_owner', { detail: 'The owner already has every right' });
    }

    const added = await addMember(app.db, room.id, userId);
    if (added) emitRoomChanged(app.io, room, 'members');
    return reply.code(204).send();
  });

  const deleteSchema = {
    tags: ['rooms'],
    summary: 'Remove a member from a room',
    description:
      'The owner removes anyone; a member can remove themselves (leave, or decline the ' +
      'invitation). Idempotent: 204 even if the user was not a member. A user removed from a ' +
      'private room stops receiving its real-time events at once.',
    security: [{ bearerAuth: [] }],
    params: memberParams,
    response: { 204: z.null().describe('The user is not a member') },
  };

  app.delete('/v1/rooms/:id/members/:userId', { schema: deleteSchema }, async (request, reply) => {
    const { room, role } = await visibleRoomOr404(request);
    const { userId } = request.params;
    if (!canRemoveMember(room, role, request.userId, userId)) {
      throw new HttpProblem(403, 'forbidden');
    }

    const removed = await removeMember(app.db, room.id, userId);
    if (removed) {
      // A private room becomes invisible to them: cut the live feed before telling the others
      if (room.visibility === 'private') removeUserFromChannel(app.io, room.id, userId);
      emitRoomChanged(app.io, room, 'members');
    }
    return reply.code(204).send();
  });
}
