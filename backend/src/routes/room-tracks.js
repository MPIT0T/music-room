import { z } from 'zod';
import { HttpProblem, problems } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { canManage, canVote } from '../rooms/access.js';
import { emitPlayback, emitRoomChanged } from '../rooms/events.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import { clearPlayback, readPlayback, writePlayback } from '../rooms/playback.js';
import { addTrack, findItem, findPlaying, listQueue, skip, unvote, vote } from '../rooms/queue.js';
import {
  addTrackBody,
  itemParams,
  locationHeaders,
  playbackBody,
  playbackResponse,
  queueItem,
  queueResponse,
  roomParams,
} from '../rooms/schemas.js';

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

  const skipSchema = {
    tags: ['rooms'],
    summary: 'Play the next track',
    description:
      'Owner only. The playing track becomes played and the most voted queued track starts ' +
      '(`playing` is null if the queue was empty). The owner phone also calls it when a track ' +
      'ends. Concurrent skips run one after the other. Returns the new queue. Subscribers ' +
      'receive `room.changed` with `change: "queue"`, then `room.playback` with the new track ' +
      'playing from 0 (or `playback: null`).',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: queueResponse, ...problems(401, 403, 404) },
  };

  app.post('/v1/rooms/:id/skip', { schema: skipSchema }, async (request) => {
    const { room, role } = await visibleRoomOr404(request);
    assertCanManage(room, role);

    const next = await skip(app.db, room.id);
    // undefined: the room was deleted between the check and the lock
    if (next === undefined) throw new HttpProblem(404, 'not_found');
    emitRoomChanged(app.io, room, 'queue');

    // The owner phone plays the next track right away
    let playback = null;
    if (next)
      playback = await writePlayback(app.redis, room.id, next, { playing: true, positionMs: 0 });
    else await clearPlayback(app.redis, room.id);
    emitPlayback(app.io, room.id, playback);

    return listQueue(app.db, room.id, request.userId);
  });

  const getPlaybackSchema = {
    tags: ['rooms'],
    summary: 'Get the playback state of a room',
    description:
      'Anyone who can see the room. Lets a phone that joins late show the right position: ' +
      'while `playing`, the position now is `positionMs + (now - at)`. `playback` is null ' +
      'when nothing plays. Updates come as `room.playback` events.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    response: { 200: playbackResponse, ...problems(401, 404) },
  };

  app.get('/v1/rooms/:id/playback', { schema: getPlaybackSchema }, async (request) => {
    const { room } = await visibleRoomOr404(request);
    const playing = await findPlaying(app.db, room.id);
    return { playback: await readPlayback(app.redis, room.id, playing) };
  });

  const putPlaybackSchema = {
    tags: ['rooms'],
    summary: 'Report play, pause or seek',
    description:
      'Owner only: the owner phone is the only player and sends its state on play, pause and ' +
      'seek. The server stamps it with its own time (`at`). 409 nothing_playing if no track ' +
      'is playing (call skip first). Subscribers receive `room.playback`.',
    security: [{ bearerAuth: [] }],
    params: roomParams,
    body: playbackBody,
    response: { 204: z.null().describe('State saved'), ...problems(400, 401, 403, 404, 409) },
  };

  app.put('/v1/rooms/:id/playback', { schema: putPlaybackSchema }, async (request, reply) => {
    const { room, role } = await visibleRoomOr404(request);
    assertCanManage(room, role);
    const playing = await findPlaying(app.db, room.id);
    if (playing == null) throw new HttpProblem(409, 'nothing_playing');

    const playback = await writePlayback(app.redis, room.id, playing, request.body);
    emitPlayback(app.io, room.id, playback);
    return reply.code(204).send();
  });
}
