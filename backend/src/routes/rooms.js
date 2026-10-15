import { z } from 'zod';
import { HttpProblem } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { withTransaction } from '../db/tx.js';
import { canManage } from '../rooms/access.js';
import { closeRoomChannel, emitRoomChanged } from '../rooms/events.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import { deleteRoom, insertRoom, updateRoom } from '../rooms/repo.js';
import {
  createRoomBody,
  ifMatchHeaders,
  patchRoomBody,
  roomParams,
  roomResponse,
  roomRuleIssues,
} from '../rooms/schemas.js';

const etag = (room) => `"${room.version}"`;

const stale = () =>
  new HttpProblem(412, 'precondition_failed', {
    detail: 'The room changed since you read it: GET it again, then retry with its new ETag',
  });

function expectedVersion(ifMatch) {
  if (ifMatch === undefined) {
    throw new HttpProblem(428, 'precondition_required', {
      detail: 'Send the ETag of the room you read in the If-Match header',
    });
  }
  const match = /^"(\d{1,15})"$/.exec(ifMatch);
  if (match == null) throw stale();
  return Number(match[1]);
}

function invalidRoom(issues) {
  const problem = new HttpProblem(400, 'validation_failed');
  problem.errors = issues.map(({ path, message }) => ({ path: path.join('.'), message }));
  return problem;
}

export default async function roomsRoutes(app) {
  app.addHook('onRequest', requireAuth);

  const createSchema = {
    tags: ['rooms'],
    summary: 'Create a room',
    description: 'The caller becomes the owner. Returns the room with its ETag.',
    security: [{ bearerAuth: [] }],
    body: createRoomBody,
    response: { 201: roomResponse },
  };

  app.post('/v1/rooms', { schema: createSchema }, async (request, reply) => {
    const room = await insertRoom(app.db, request.userId, request.body);
    return reply
      .code(201)
      .header('etag', etag(room))
      .header('location', `/v1/rooms/${room.id}`)
      .send(room);
  });

  const getSchema = {
    tags: ['rooms'],
    summary: 'Read a room',
    description:
      'Public rooms are readable by any signed-in user, private rooms by their owner and ' +
      'invited users only. Anyone else gets the same 404 as for a room that does not exist.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: roomResponse },
  };

  app.get('/v1/rooms/:id', { schema: getSchema }, async (request, reply) => {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    return reply.header('etag', etag(visible.room)).send(visible.room);
  });

  const patchSchema = {
    tags: ['rooms'],
    summary: 'Edit a room',
    description:
      'Owner only. Send only the fields to change, and the ETag from GET in If-Match: ' +
      '428 without it, 412 if the room changed since. Returns the room with its new ETag.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    headers: ifMatchHeaders,
    body: patchRoomBody,
    response: { 200: roomResponse },
  };

  app.patch('/v1/rooms/:id', { schema: patchSchema }, async (request, reply) => {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    if (!canManage(visible.room, visible.role)) throw new HttpProblem(403, 'forbidden');

    const version = expectedVersion(request.headers['if-match']);
    if (version !== visible.room.version) throw stale();

    const next = { ...visible.room, ...request.body };
    const issues = roomRuleIssues(next);
    if (issues.length > 0) throw invalidRoom(issues);

    const room = await withTransaction(app.db, (conn) =>
      updateRoom(conn, visible.room.id, version, next),
    );
    if (room == null) throw stale();
    return reply.header('etag', etag(room)).send(room);
  });

  const deleteSchema = {
    tags: ['rooms'],
    summary: 'Delete a room',
    description:
      'Owner only. Deletes the room with its queue, votes and members, then sends ' +
      '`room.changed` with `change: "deleted"` to subscribers and removes them from the room. ' +
      '404 if the room does not exist or is not visible to the caller, 403 if the caller can ' +
      'see it but is not the owner.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 204: z.null().describe('Room deleted') },
  };

  app.delete('/v1/rooms/:id', { schema: deleteSchema }, async (request, reply) => {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    if (!canManage(visible.room, visible.role)) throw new HttpProblem(403, 'forbidden');

    const { room } = visible;
    const deleted = await deleteRoom(app.db, room.id, room.ownerId);
    if (!deleted) throw new HttpProblem(404, 'not_found');

    emitRoomChanged(app.io, { ...room, version: room.version + 1 }, 'deleted');
    closeRoomChannel(app.io, room.id);
    return reply.code(204).send();
  });
}
