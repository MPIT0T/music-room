import { z } from 'zod';
import { HttpProblem, problems } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { canControl, canTransfer } from '../delegation/access.js';
import { isDeviceOnline } from '../devices/presence.js';
import { findDelegation, findDevice } from '../devices/repo.js';
import { canManage, canVote } from '../rooms/access.js';
import { emitPlayback, emitPlaybackStop, emitRoomChanged } from '../rooms/events.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import {
  claimActiveDevice,
  clearPlayback,
  readActiveDevice,
  readPlayback,
  writeActiveDevice,
  writePlayback,
} from '../rooms/playback.js';
import {
  STALE,
  addTrack,
  findItem,
  findPlaying,
  listQueue,
  skip,
  unvote,
  vote,
} from '../rooms/queue.js';
import {
  addTrackBody,
  itemParams,
  locationHeaders,
  playbackBody,
  playbackResponse,
  queueItem,
  queueResponse,
  roomParams,
  skipBody,
  transferBody,
} from '../rooms/schemas.js';
import { rateLimit } from '../security/rate-limit.js';

export default async function roomTracksRoutes(app) {
  app.addHook('onRequest', requireAuth);

  function assertCanManage(room, role) {
    if (!canManage(room, role)) throw new HttpProblem(403, 'forbidden');
  }

  async function visibleRoomOr404(request) {
    const visible = await loadVisibleRoom(app.db, request.params.id, request.userId);
    if (visible == null) throw new HttpProblem(404, 'not_found');
    return visible;
  }

  // 403 with the reason as code: not_invited, outside_time_window, location_required,
  // outside_place, misconfigured. The X-Location header is parsed by locationHeaders.
  function assertCanVote(room, role, request) {
    const location = request.headers['x-location'] ?? null;
    const verdict = canVote(room, role, { now: new Date(), location });
    if (!verdict.allowed) throw new HttpProblem(403, verdict.reason);
  }

  // The item must belong to this room: an id from another room is not found
  async function itemOr404(room, request) {
    const item = await findItem(app.db, room.id, request.params.itemId, request.userId);
    if (item == null) throw new HttpProblem(404, 'item_not_found');
    return item;
  }

  const listSchema = {
    tags: ['rooms'],
    summary: 'Get the playing track and the vote queue of a room',
    description:
      'Anyone who can see the room. The queue is sorted by votes (most first), then by ' +
      'proposal date (oldest first). `myVote` tells whether the caller voted for an item. ' +
      'A private room answers 404 to anyone who is neither owner nor member.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: queueResponse, ...problems(401, 404) },
  };

  app.get('/v1/rooms/:id/tracks', { schema: listSchema }, async (request) => {
    const { room } = await visibleRoomOr404(request);
    return listQueue(app.db, room.id, request.userId);
  });

  const addSchema = {
    tags: ['rooms'],
    summary: 'Propose a track',
    description:
      'Anyone allowed to vote (see the room access policy), else 403 with the reason as code. ' +
      'In a place_time room, send the phone position in X-Location. ' +
      'A track already queued or playing is not added twice: 200 with the existing item ' +
      'instead of 201. A track already played can be proposed again. 404 track_not_found for ' +
      'an unknown track. Subscribers receive `room.changed` with `change: "queue"`.',
    security: [{ bearerAuth: [] }],
    headers: locationHeaders,
    params: roomParams,
    body: addTrackBody,
    response: { 200: queueItem, 201: queueItem, ...problems(400, 401, 403, 404) },
  };

  app.post('/v1/rooms/:id/tracks', { schema: addSchema }, async (request, reply) => {
    const { room, role } = await visibleRoomOr404(request);
    assertCanVote(room, role, request);

    const { item, created } = await addTrack(app.db, room.id, request.body.trackId, request.userId);
    if (created) emitRoomChanged(app.io, room, 'queue');
    return reply.code(created ? 201 : 200).send(item);
  });

  const voteSchema = {
    tags: ['rooms'],
    summary: 'Vote for a queued track',
    description:
      'Anyone allowed to vote, one vote per user and item. Idempotent: voting twice changes ' +
      'nothing. 409 not_queued if the item is playing or already played. Subscribers receive ' +
      '`room.changed` with `change: "queue"`.',
    security: [{ bearerAuth: [] }],
    headers: locationHeaders,
    params: itemParams,
    response: {
      204: z.null().describe('The caller votes for this item'),
      ...problems(400, 401, 403, 404, 409),
    },
  };

  app.put('/v1/rooms/:id/tracks/:itemId/vote', { schema: voteSchema }, async (request, reply) => {
    const { room, role } = await visibleRoomOr404(request);
    assertCanVote(room, role, request);
    const item = await itemOr404(room, request);
    if (item.status !== 'queued') throw new HttpProblem(409, 'not_queued');

    if (await vote(app.db, item.id, request.userId)) emitRoomChanged(app.io, room, 'queue');
    return reply.code(204).send();
  });

  const unvoteSchema = {
    tags: ['rooms'],
    summary: 'Remove your vote',
    description:
      'Anyone allowed to vote, whatever the item status. Idempotent: 204 even without a vote. ' +
      'Subscribers receive `room.changed` with `change: "queue"`.',
    security: [{ bearerAuth: [] }],
    headers: locationHeaders,
    params: itemParams,
    response: {
      204: z.null().describe('The caller does not vote for this item'),
      ...problems(400, 401, 403, 404),
    },
  };

  app.delete(
    '/v1/rooms/:id/tracks/:itemId/vote',
    { schema: unvoteSchema },
    async (request, reply) => {
      const { room, role } = await visibleRoomOr404(request);
      assertCanVote(room, role, request);
      const item = await itemOr404(room, request);

      if (await unvote(app.db, item.id, request.userId)) emitRoomChanged(app.io, room, 'queue');
      return reply.code(204).send();
    },
  );

  // Who may press play, pause, seek and skip: the owner from any of his devices, or a friend
  // the active device was delegated to (delegation/access.js). 403 with the reason as code:
  // no_active_device, not_delegated, delegation_expired.
  // Returns the active device id after the call: an owner device that acts while no device
  // plays becomes the player.
  async function assertCanControl(room, request) {
    let activeId = await readActiveDevice(app.redis, room.id);
    const isOwner = request.userId === room.ownerId;
    if (activeId == null && isOwner) {
      activeId = await claimActiveDevice(app.redis, room.id, request.deviceId);
    }
    if (activeId != null && activeId !== request.deviceId) {
      if (!(await isDeviceOnline(app.io, activeId))) {
        if (!isOwner) throw new HttpProblem(409, 'device_offline');
        await writeActiveDevice(app.redis, room.id, request.deviceId);
        activeId = request.deviceId;
      }
    }
    if (isOwner) return activeId;

    const activeDevice = activeId == null ? null : await findDevice(app.db, activeId);
    const delegation =
      activeDevice == null ? null : await findDelegation(app.db, activeDevice.id, request.userId);
    const verdict = canControl(room.ownerId, activeDevice, request.userId, delegation, {
      now: new Date(),
    });
    if (!verdict.allowed) throw new HttpProblem(403, verdict.reason);
    return activeId;
  }

  // Every command leaves a line: who, from which device, on which room and player
  function logCommand(request, room, activeDeviceId, action, extra = {}) {
    request.log.info(
      {
        roomId: room.id,
        action,
        activeDeviceId,
        delegated: request.userId !== room.ownerId,
        ...extra,
      },
      'playback command',
    );
  }

  const controlLimit = rateLimit(app.limits.playbackControl, (request) => request.userId);

  const skipSchema = {
    tags: ['rooms'],
    summary: 'Play the next track',
    description:
      'The owner (any of his devices) or a friend the playing device was delegated to. The ' +
      'playing track becomes played and the most voted queued track starts (`playing` is null ' +
      'if the queue was empty). The playing device also calls it when a track ends. Concurrent ' +
      'skips run one after the other; with `expectedRoomTrackId`, a skip whose track already ' +
      'changed answers 409 stale and skips nothing. Returns the new queue. Subscribers ' +
      'receive `room.changed` with `change: "queue"`, then `room.playback` with the new track ' +
      'playing from 0 (or `playback: null`). 403 no_active_device, not_delegated, ' +
      'delegation_expired.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    body: skipBody,
    response: { 200: queueResponse, ...problems(401, 403, 404, 409, 429) },
  };

  app.post(
    '/v1/rooms/:id/skip',
    { schema: skipSchema, preHandler: controlLimit },
    async (request) => {
      const { room } = await visibleRoomOr404(request);
      const activeDeviceId = await assertCanControl(room, request);

      const expectedItemId = request.body?.expectedRoomTrackId;
      const next = await skip(app.db, room.id, { expectedItemId });
      // undefined: the room was deleted between the check and the lock
      if (next === undefined) throw new HttpProblem(404, 'not_found');
      if (next === STALE) throw new HttpProblem(409, 'stale');
      emitRoomChanged(app.io, room, 'queue');
      logCommand(request, room, activeDeviceId, 'skip');

      // The playing device plays the next track right away
      let playback = null;
      if (next)
        playback = await writePlayback(app.redis, room.id, next, { playing: true, positionMs: 0 });
      else await clearPlayback(app.redis, room.id);
      emitPlayback(app.io, room.id, playback, activeDeviceId);

      return listQueue(app.db, room.id, request.userId);
    },
  );

  // canControl in the answer: whether this caller may press the buttons, without trying
  async function callerCanControl(room, request, activeId) {
    if (request.userId === room.ownerId) return true;
    if (activeId != null && !(await isDeviceOnline(app.io, activeId))) return false;
    const activeDevice = activeId == null ? null : await findDevice(app.db, activeId);
    const delegation =
      activeDevice == null ? null : await findDelegation(app.db, activeDevice.id, request.userId);
    return canControl(room.ownerId, activeDevice, request.userId, delegation, { now: new Date() })
      .allowed;
  }

  const getPlaybackSchema = {
    tags: ['rooms'],
    summary: 'Get the playback state of a room',
    description:
      'Anyone who can see the room. Lets a phone that joins late show the right position: ' +
      'while `playing`, the position now is `positionMs + (now - at)`. `playback` is null ' +
      'when nothing plays. `activeDeviceId` is the device that plays the sound: the device ' +
      'whose id it is plays, the others are remotes. `canControl` tells the caller whether ' +
      'to show the buttons. Updates come as `room.playback` events.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: playbackResponse, ...problems(401, 404) },
  };

  app.get('/v1/rooms/:id/playback', { schema: getPlaybackSchema }, async (request) => {
    const { room } = await visibleRoomOr404(request);
    const playing = await findPlaying(app.db, room.id);
    const activeDeviceId = await readActiveDevice(app.redis, room.id);
    return {
      playback: await readPlayback(app.redis, room.id, playing),
      activeDeviceId,
      canControl: await callerCanControl(room, request, activeDeviceId),
    };
  });

  const putPlaybackSchema = {
    tags: ['rooms'],
    summary: 'Play, pause or seek',
    description:
      'The owner (any of his devices) or a friend the playing device was delegated to. The ' +
      'playing device sends its state on play, pause and seek; a remote sends the state it ' +
      'wants, and the playing device follows the `room.playback` event. The first owner ' +
      'device to act while no device plays becomes the playing device. The server stamps ' +
      'the state with its own time (`at`). 409 nothing_playing if no track is playing (call ' +
      'skip first). 403 no_active_device, not_delegated, delegation_expired.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    body: playbackBody,
    response: {
      204: z.null().describe('State saved'),
      ...problems(400, 401, 403, 404, 409, 429),
    },
  };

  app.put(
    '/v1/rooms/:id/playback',
    { schema: putPlaybackSchema, preHandler: controlLimit },
    async (request, reply) => {
      const { room } = await visibleRoomOr404(request);
      const playing = await findPlaying(app.db, room.id);
      if (playing == null) throw new HttpProblem(409, 'nothing_playing');
      const activeDeviceId = await assertCanControl(room, request);

      const playback = await writePlayback(app.redis, room.id, playing, request.body);
      emitPlayback(app.io, room.id, playback, activeDeviceId);
      logCommand(request, room, activeDeviceId, request.body.playing ? 'play' : 'pause', {
        positionMs: request.body.positionMs,
      });
      return reply.code(204).send();
    },
  );

  const transferSchema = {
    tags: ['rooms'],
    summary: 'Move the sound of a room to another of my devices',
    description:
      'Owner only (403 forbidden). The target must be one of my devices (404 device_not_found) ' +
      'and connected (409 device_offline). The previous device receives ' +
      '`room.playback.stop`; subscribers receive `room.playback` with the new ' +
      '`activeDeviceId`, which then plays from `positionMs + (now - at)`. Friends keep control ' +
      'only if the new device is delegated to them.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    body: transferBody,
    response: { 200: playbackResponse, ...problems(400, 401, 403, 404, 409, 429) },
  };

  app.put(
    '/v1/rooms/:id/playback/device',
    { schema: transferSchema, preHandler: controlLimit },
    async (request) => {
      const { room, role } = await visibleRoomOr404(request);
      assertCanManage(room, role);

      const target = await findDevice(app.db, request.body.deviceId);
      if (target == null) throw new HttpProblem(404, 'device_not_found');
      const verdict = canTransfer(room.ownerId, target, request.userId);
      if (!verdict.allowed) throw new HttpProblem(404, 'device_not_found');
      if (!(await isDeviceOnline(app.io, target.id))) {
        throw new HttpProblem(409, 'device_offline');
      }

      const previous = await readActiveDevice(app.redis, room.id);
      await writeActiveDevice(app.redis, room.id, target.id);
      const playback = await readPlayback(app.redis, room.id, await findPlaying(app.db, room.id));
      if (previous != null && previous !== target.id) {
        emitPlaybackStop(app.io, room.id, previous);
      }
      emitPlayback(app.io, room.id, playback, target.id);
      logCommand(request, room, target.id, 'transfer', { previousDeviceId: previous });
      return { playback, activeDeviceId: target.id, canControl: true };
    },
  );
}
