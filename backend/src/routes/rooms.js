import { z } from 'zod';
import { HttpProblem, problems } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { withTransaction } from '../db/tx.js';
import { canManage } from '../rooms/access.js';
import { closeRoomChannel, emitRoomChanged, keepOnlyUsersInChannel } from '../rooms/events.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import {
  countOwnedRooms,
  deleteRoom,
  findRoomByBeacon,
  insertRoom,
  listMembers,
  listVisibleRooms,
  updateRoom,
} from '../rooms/repo.js';
import {
  createRoomBody,
  ifMatchHeaders,
  listRoomsQuery,
  patchRoomBody,
  roomParams,
  roomResponse,
  roomRuleIssues,
  roomsResponse,
} from '../rooms/schemas.js';
import { clearActiveDevice, clearPlayback } from '../rooms/playback.js';
import {
  FREE_ROOM_LIMIT,
  premiumIssues,
  premiumRequired,
  roomLimitReached,
} from '../users/plan.js';
import { lockPlan } from '../users/repo.js';

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
    description:
      'The caller becomes the owner. Returns the room with its ETag. `visibility`: who finds ' +
      'the room (private: owner and members only). `accessPolicy`: who proposes and votes ' +
      '(everyone, invited members, or place_time: people inside `place` during `window`, ' +
      'both required, who send their position in X-Location). The owner is never restricted. ' +
      '409 beacon_taken if another room already uses `beaconMinor`. Free accounts host one ' +
      'public room open to everyone, without beacon: 403 premium_required (fields listed in ' +
      '`errors`) or 403 room_limit_reached.',
    security: [{ bearerAuth: [] }],
    body: createRoomBody,
    response: { 201: roomResponse, ...problems(400, 401, 403, 409) },
  };

  app.post('/v1/rooms', { schema: createSchema }, async (request, reply) => {
    const room = await withTransaction(app.db, async (conn) => {
      // The owner row stays locked: two creations at once cannot both pass the free limit
      const plan = await lockPlan(conn, request.userId);
      if (plan == null) throw new HttpProblem(401, 'unauthorized');
      if (plan === 'free') {
        const issues = premiumIssues(request.body);
        if (issues.length > 0) throw premiumRequired(issues);
        if ((await countOwnedRooms(conn, request.userId)) >= FREE_ROOM_LIMIT) {
          throw roomLimitReached();
        }
      }
      return insertRoom(conn, request.userId, request.body);
    });
    return reply
      .code(201)
      .header('etag', etag(room))
      .header('location', `/v1/rooms/${room.id}`)
      .send(room);
  });

  const listSchema = {
    tags: ['rooms'],
    summary: 'Find rooms',
    description:
      'Public rooms, plus the private ones the caller owns or was invited to, newest first. ' +
      'With `beacon`, the minor of an iBeacon the phone picked up: only the public room ' +
      'with that minor (a private room is never revealed by a beacon), or an empty list.',
    security: [{ bearerAuth: [] }],
    querystring: listRoomsQuery,
    response: { 200: roomsResponse, ...problems(400, 401) },
  };

  app.get('/v1/rooms', { schema: listSchema }, async (request) => {
    const { beacon, limit } = request.query;
    if (beacon !== undefined) {
      const room = await findRoomByBeacon(app.db, beacon);
      return { rooms: room ? [room] : [] };
    }
    return { rooms: await listVisibleRooms(app.db, request.userId, limit) };
  });

  const getSchema = {
    tags: ['rooms'],
    summary: 'Read a room',
    description:
      'Public rooms are readable by any signed-in user, private rooms by their owner and ' +
      'invited users only. Anyone else gets the same 404 as for a room that does not exist.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: roomResponse, ...problems(401, 404) },
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
      '428 without it, 412 if the room changed since. Returns the room with its new ETag. ' +
      '409 beacon_taken if another room already uses `beaconMinor`. Subscribers then ' +
      'receive `room.changed` with `change: "settings"` and the new version; when the room ' +
      'turns private, sockets of users who are neither owner nor member then leave it. A free owner ' +
      'gets 403 premium_required when setting a premium value (private, invited, place_time, ' +
      'beacon); values already stored are kept, so a room made on premium stays as it is.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    headers: ifMatchHeaders,
    body: patchRoomBody,
    response: { 200: roomResponse, ...problems(400, 401, 403, 404, 409, 412, 428) },
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

    const room = await withTransaction(app.db, async (conn) => {
      const plan = await lockPlan(conn, request.userId);
      if (plan === 'free') {
        const premium = premiumIssues(next, visible.room);
        if (premium.length > 0) throw premiumRequired(premium);
      }
      return updateRoom(conn, visible.room.id, version, next);
    });
    if (room == null) throw stale();

    emitRoomChanged(app.io, room, 'settings');
    if (visible.room.visibility === 'public' && room.visibility === 'private') {
      const members = await listMembers(app.db, room.id);
      keepOnlyUsersInChannel(app.io, room.id, [room.ownerId, ...members.map((m) => m.userId)]);
    }
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
    response: { 204: z.null().describe('Room deleted'), ...problems(401, 403, 404) },
  };

  app.delete('/v1/rooms/:id', { schema: deleteSchema }, async (request, reply) => {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    if (!canManage(visible.room, visible.role)) throw new HttpProblem(403, 'forbidden');

    const { room } = visible;
    const deleted = await deleteRoom(app.db, room.id, room.ownerId);
    if (!deleted) throw new HttpProblem(404, 'not_found');
    await clearPlayback(app.redis, room.id);
    await clearActiveDevice(app.redis, room.id);

    emitRoomChanged(app.io, { ...room, version: room.version + 1 }, 'deleted');
    closeRoomChannel(app.io, room.id);
    return reply.code(204).send();
  });
}
