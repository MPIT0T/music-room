import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';

// Integration tests: real MariaDB (make test). Users, rooms and tracks are unique to this run.
const RUN = randomUUID().slice(0, 8);

let app;
const users = {};
const voters = [];
const tracks = {};

// Records what the routes send through Socket.IO, without a socket server
const sent = [];
const fakeIo = {
  to: (channel) => ({ emit: (event, data) => sent.push({ to: channel, event, data }) }),
  in: (target) => ({
    socketsLeave: (channel) => sent.push({ in: target, leave: channel }),
    // Every device is connected here: offline players are tested in delegation.test.js
    fetchSockets: async () => [{ id: 'socket' }],
  }),
};

async function createUser(name) {
  const [[row]] = await app.db.query(
    "INSERT INTO users (display_name, plan) VALUES (?, 'premium') RETURNING id",
    [`queue-${RUN}-${name}`],
  );
  // A real devices row: the playing device of a room is looked up for delegations
  const deviceId = randomUUID();
  await app.db.query(
    "INSERT INTO devices (id, user_id, name, platform) VALUES (?, ?, 'test', 'web')",
    [deviceId, row.id],
  );
  const token = await app.tokens.signAccessToken({ userId: row.id, deviceId });
  return { id: row.id, token, deviceId };
}

async function createTrack(name) {
  const [[row]] = await app.db.query(
    `INSERT INTO tracks (provider, provider_track_id, title, artist, duration_ms)
     VALUES ('jamendo', ?, ?, 'Test Artist', 180000) RETURNING id`,
    [`queue-${RUN}-${name}`, name],
  );
  return row.id;
}

before(async () => {
  app = await buildApp({ logger: false });
  app.decorate('io', fakeIo);
  for (const name of ['owner', 'guest', 'other', 'stranger']) users[name] = await createUser(name);
  for (let i = 0; i < 50; i++) voters.push(await createUser(`voter-${i}`));
  for (const name of ['a', 'b', 'c', 'd']) tracks[name] = await createTrack(name);
});

beforeEach(() => {
  sent.length = 0;
});

after(async () => {
  const ids = [...Object.values(users), ...voters].map((user) => user.id);
  const [rooms] = await app.db.query('SELECT id FROM rooms WHERE owner_id IN (?)', [ids]);
  if (rooms.length) {
    await app.redis.del(
      rooms.flatMap((room) => [`playback:${room.id}`, `playback-device:${room.id}`]),
    );
  }
  // rooms first: their room_tracks and votes go with them (ON DELETE CASCADE)
  await app.db.query('DELETE FROM rooms WHERE owner_id IN (?)', [ids]);
  await app.db.query('DELETE FROM tracks WHERE provider_track_id LIKE ?', [`queue-${RUN}-%`]);
  await app.db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  await app.close();
});

const auth = (user) => ({ authorization: `Bearer ${user.token}` });

async function createRoom(user, payload) {
  const res = await app.inject({ method: 'POST', url: '/v1/rooms', headers: auth(user), payload });
  assert.equal(res.statusCode, 201);
  return res.json();
}

const invite = (actor, roomId, userId) =>
  app.inject({ method: 'PUT', url: `/v1/rooms/${roomId}/members/${userId}`, headers: auth(actor) });
const getQueue = (actor, roomId) =>
  app.inject({ url: `/v1/rooms/${roomId}/tracks`, headers: auth(actor) });
// extra: more headers, such as X-Location
const propose = (actor, roomId, trackId, extra = {}) =>
  app.inject({
    method: 'POST',
    url: `/v1/rooms/${roomId}/tracks`,
    headers: { ...auth(actor), ...extra },
    payload: { trackId },
  });
const vote = (actor, roomId, itemId, extra = {}) =>
  app.inject({
    method: 'PUT',
    url: `/v1/rooms/${roomId}/tracks/${itemId}/vote`,
    headers: { ...auth(actor), ...extra },
  });
const unvote = (actor, roomId, itemId, extra = {}) =>
  app.inject({
    method: 'DELETE',
    url: `/v1/rooms/${roomId}/tracks/${itemId}/vote`,
    headers: { ...auth(actor), ...extra },
  });
const skip = (actor, roomId) =>
  app.inject({ method: 'POST', url: `/v1/rooms/${roomId}/skip`, headers: auth(actor) });
const getPlayback = (actor, roomId) =>
  app.inject({ url: `/v1/rooms/${roomId}/playback`, headers: auth(actor) });
const putPlayback = (actor, roomId, payload) =>
  app.inject({
    method: 'PUT',
    url: `/v1/rooms/${roomId}/playback`,
    headers: auth(actor),
    payload,
  });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

const queueEvent = (room) => ({
  to: `room:${room.id}`,
  event: 'room.changed',
  data: { roomId: room.id, version: room.version, change: 'queue' },
});

// Proposes the tracks in order and returns their item ids
async function fill(room, ...names) {
  const ids = [];
  for (const name of names) ids.push((await propose(users.owner, room.id, tracks[name])).json().id);
  sent.length = 0;
  return ids;
}

const queueTitles = async (actor, roomId) =>
  (await getQueue(actor, roomId)).json().queue.map((item) => item.track.title);

test('a new room has nothing playing and an empty queue', async () => {
  const room = await createRoom(users.owner, { name: 'Empty' });
  const res = await getQueue(users.stranger, room.id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { playing: null, queue: [] });
});

test('proposing a track: 201, the item, one event; never the provider id', async () => {
  const room = await createRoom(users.owner, { name: 'Propose' });

  const res = await propose(users.guest, room.id, tracks.a);
  assert.equal(res.statusCode, 201, res.body);
  const item = res.json();
  assert.deepEqual(Object.keys(item).sort(), [
    'addedBy',
    'createdAt',
    'id',
    'myVote',
    'track',
    'votes',
  ]);
  assert.deepEqual(item.track, {
    id: tracks.a,
    title: 'a',
    artist: 'Test Artist',
    durationMs: 180000,
    coverUrl: null,
  });
  assert.equal(item.addedBy, users.guest.id);
  assert.equal(item.votes, 0);
  assert.equal(item.myVote, false);
  assert.match(item.createdAt, /Z$/);
  assert.deepEqual(sent, [queueEvent(room)]);

  assert.deepEqual((await getQueue(users.stranger, room.id)).json().queue, [item]);
});

test('proposing a track already queued: 200 with the same item, no event', async () => {
  const room = await createRoom(users.owner, { name: 'Duplicate' });
  const [id] = await fill(room, 'a');

  const res = await propose(users.guest, room.id, tracks.a);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, id);
  assert.equal((await getQueue(users.owner, room.id)).json().queue.length, 1);
  assert.deepEqual(sent, []);
});

test('a playing track cannot be proposed again, a played one can', async () => {
  const room = await createRoom(users.owner, { name: 'Replay' });
  const [id] = await fill(room, 'a');

  await skip(users.owner, room.id); // a is playing
  const playing = await propose(users.guest, room.id, tracks.a);
  assert.equal(playing.statusCode, 200);
  assert.equal(playing.json().id, id);

  await skip(users.owner, room.id); // a is played
  const again = await propose(users.guest, room.id, tracks.a);
  assert.equal(again.statusCode, 201);
  assert.notEqual(again.json().id, id);
});

test('the queue is sorted by votes, then by proposal date', async () => {
  const room = await createRoom(users.owner, { name: 'Order' });
  const [, b, c] = await fill(room, 'a', 'b', 'c', 'd');

  await vote(users.guest, room.id, c);
  await vote(users.other, room.id, c);
  await vote(users.guest, room.id, b);

  assert.deepEqual(await queueTitles(users.stranger, room.id), ['c', 'b', 'a', 'd']);
  const queue = (await getQueue(users.guest, room.id)).json().queue;
  assert.deepEqual(
    queue.map((item) => [item.votes, item.myVote]),
    [
      [2, true],
      [1, true],
      [0, false],
      [0, false],
    ],
  );
});

test('voting is idempotent: 204 twice, one vote, one event', async () => {
  const room = await createRoom(users.owner, { name: 'Vote twice' });
  const [id] = await fill(room, 'a');

  for (let i = 0; i < 2; i++) {
    const res = await vote(users.guest, room.id, id);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  }
  assert.equal((await getQueue(users.owner, room.id)).json().queue[0].votes, 1);
  assert.deepEqual(sent, [queueEvent(room)]);
});

test('removing a vote is idempotent: 204 twice, one event', async () => {
  const room = await createRoom(users.owner, { name: 'Unvote' });
  const [id] = await fill(room, 'a');
  await vote(users.guest, room.id, id);
  sent.length = 0;

  assert.equal((await unvote(users.guest, room.id, id)).statusCode, 204);
  assert.equal((await unvote(users.guest, room.id, id)).statusCode, 204);
  assert.equal((await getQueue(users.owner, room.id)).json().queue[0].votes, 0);
  assert.deepEqual(sent, [queueEvent(room)]);
});

test('only queued items take votes (409 not_queued), a vote can always be removed', async () => {
  const room = await createRoom(users.owner, { name: 'Not queued' });
  const [id] = await fill(room, 'a');
  await vote(users.guest, room.id, id);
  await skip(users.owner, room.id); // a is playing
  sent.length = 0;

  assertProblem(await vote(users.other, room.id, id), 409, 'not_queued');
  assert.equal((await unvote(users.guest, room.id, id)).statusCode, 204);
  assert.equal((await getQueue(users.owner, room.id)).json().playing.votes, 0);
});

test('an item of another room is not found', async () => {
  const room = await createRoom(users.owner, { name: 'Here' });
  const elsewhere = await createRoom(users.owner, { name: 'There', visibility: 'private' });
  const [id] = await fill(elsewhere, 'a');

  assertProblem(await vote(users.stranger, room.id, id), 404, 'item_not_found');
  assertProblem(await unvote(users.stranger, room.id, id), 404, 'item_not_found');
  assertProblem(await vote(users.stranger, room.id, randomUUID()), 404, 'item_not_found');
  assertProblem(await vote(users.owner, room.id, 'not-a-uuid'), 400, 'validation_failed');
});

test('a private room stays hidden: 404 on every queue route for a stranger', async () => {
  const room = await createRoom(users.owner, { name: 'Hidden', visibility: 'private' });
  const [id] = await fill(room, 'a');

  assertProblem(await getQueue(users.stranger, room.id), 404, 'not_found');
  assertProblem(await propose(users.stranger, room.id, tracks.b), 404, 'not_found');
  assertProblem(await vote(users.stranger, room.id, id), 404, 'not_found');
  assertProblem(await unvote(users.stranger, room.id, id), 404, 'not_found');
  assertProblem(await skip(users.stranger, room.id), 404, 'not_found');

  await invite(users.owner, room.id, users.guest.id);
  assert.equal((await getQueue(users.guest, room.id)).statusCode, 200);
  assert.equal((await vote(users.guest, room.id, id)).statusCode, 204);
});

test('policy invited: anyone sees the public queue, only members propose and vote', async () => {
  const room = await createRoom(users.owner, { name: 'Members vote', accessPolicy: 'invited' });
  const [id] = await fill(room, 'a');
  await invite(users.owner, room.id, users.guest.id);
  sent.length = 0;

  assert.equal((await getQueue(users.stranger, room.id)).statusCode, 200);
  assertProblem(await propose(users.stranger, room.id, tracks.b), 403, 'not_invited');
  assertProblem(await vote(users.stranger, room.id, id), 403, 'not_invited');
  assertProblem(await unvote(users.stranger, room.id, id), 403, 'not_invited');
  assert.deepEqual(sent, []);

  assert.equal((await propose(users.guest, room.id, tracks.b)).statusCode, 201);
  assert.equal((await vote(users.guest, room.id, id)).statusCode, 204);
});

// Place Bellecour, Lyon; ~111 m and ~334 m north of it
const place = { lat: 45.7578, lng: 4.832, radiusM: 200 };
const near = { 'x-location': '45.7588,4.832' };
const far = { 'x-location': '45.7608,4.832' };
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString();

test('policy place_time: outside the window the queue is visible but frozen', async () => {
  const room = await createRoom(users.owner, {
    name: 'Past party',
    accessPolicy: 'place_time',
    window: { start: '2020-01-01T16:00:00Z', end: '2020-01-01T18:00:00Z' },
    place,
  });
  const [id] = await fill(room, 'a');

  assert.equal((await getQueue(users.guest, room.id)).statusCode, 200);
  assertProblem(await propose(users.guest, room.id, tracks.b, near), 403, 'outside_time_window');
  assertProblem(await vote(users.guest, room.id, id, near), 403, 'outside_time_window');
  // the owner is never limited by the policy
  assert.equal((await vote(users.owner, room.id, id)).statusCode, 204);
});

test('policy place_time: during the window, only phones inside the place vote', async () => {
  const room = await createRoom(users.owner, {
    name: 'Live party',
    accessPolicy: 'place_time',
    window: { start: hours(-1), end: hours(1) },
    place,
  });
  const [id] = await fill(room, 'a');

  assertProblem(await vote(users.guest, room.id, id), 403, 'location_required');
  assertProblem(await vote(users.guest, room.id, id, far), 403, 'outside_place');
  assertProblem(await propose(users.guest, room.id, tracks.b, far), 403, 'outside_place');
  assert.deepEqual(sent, []);

  assert.equal((await vote(users.guest, room.id, id, near)).statusCode, 204);
  assert.equal((await propose(users.guest, room.id, tracks.b, near)).statusCode, 201);
  assert.equal((await unvote(users.guest, room.id, id, near)).statusCode, 204);
});

test('X-Location must be "lat,lng" in range: 400 otherwise', async () => {
  const room = await createRoom(users.owner, { name: 'Bad location' });
  const [id] = await fill(room, 'a');

  for (const value of ['45.75', '45.75;4.83', 'abc,def', '91,0', '0,181', '45.75, 4.83']) {
    assertProblem(
      await vote(users.guest, room.id, id, { 'x-location': value }),
      400,
      'validation_failed',
    );
  }
  // Ignored where the policy does not need it
  assert.equal((await vote(users.guest, room.id, id, near)).statusCode, 204);
});

test('proposing an unknown track: 404 track_not_found; a malformed id: 400', async () => {
  const room = await createRoom(users.owner, { name: 'Unknown' });
  assertProblem(await propose(users.guest, room.id, randomUUID()), 404, 'track_not_found');
  assertProblem(await propose(users.guest, room.id, 'nope'), 400, 'validation_failed');
  assert.deepEqual(sent, []);
});

test('skip: the most voted track starts, the previous one is played', async () => {
  const room = await createRoom(users.owner, { name: 'Skip' });
  const [a, b] = await fill(room, 'a', 'b');
  await vote(users.guest, room.id, b);
  sent.length = 0;

  const res = await skip(users.owner, room.id);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().playing.id, b);
  assert.deepEqual(
    res.json().queue.map((item) => item.id),
    [a],
  );
  assert.deepEqual(sent[0], queueEvent(room));
  assert.deepEqual(
    sent.map((entry) => entry.event),
    ['room.changed', 'room.playback'],
  );

  const second = (await skip(users.owner, room.id)).json();
  assert.equal(second.playing.id, a);
  assert.deepEqual(second.queue, []);
  const [[{ status }]] = await app.db.query('SELECT status FROM room_tracks WHERE id = ?', [b]);
  assert.equal(status, 'played');

  assert.deepEqual((await skip(users.owner, room.id)).json(), { playing: null, queue: [] });
});

test('without a delegation, a member or a stranger cannot skip (403)', async () => {
  const room = await createRoom(users.owner, { name: 'Owner skips' });
  await fill(room, 'a');
  await invite(users.owner, room.id, users.guest.id);

  // No device plays yet: nobody but the owner can act
  assertProblem(await skip(users.guest, room.id), 403, 'no_active_device');
  assertProblem(await skip(users.stranger, room.id), 403, 'no_active_device');
  assert.equal((await getQueue(users.owner, room.id)).json().playing, null);
});

test('queue routes need an access token', async () => {
  const room = await createRoom(users.owner, { name: 'Token' });
  const item = randomUUID();
  for (const [method, url] of [
    ['GET', `/v1/rooms/${room.id}/tracks`],
    ['POST', `/v1/rooms/${room.id}/tracks`],
    ['PUT', `/v1/rooms/${room.id}/tracks/${item}/vote`],
    ['DELETE', `/v1/rooms/${room.id}/tracks/${item}/vote`],
    ['POST', `/v1/rooms/${room.id}/skip`],
    ['GET', `/v1/rooms/${room.id}/playback`],
    ['PUT', `/v1/rooms/${room.id}/playback`],
  ]) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url}`);
  }
});

// Playback: the owner phone reports play, pause and seek; the others read it

const playbackEvents = () => sent.filter((entry) => entry.event === 'room.playback');

test('nothing plays: playback null, and the owner cannot report a state (409)', async () => {
  const room = await createRoom(users.owner, { name: 'Silent' });
  await fill(room, 'a');

  const res = await getPlayback(users.stranger, room.id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { playback: null, activeDeviceId: null, canControl: false });
  assertProblem(
    await putPlayback(users.owner, room.id, { playing: true, positionMs: 0 }),
    409,
    'nothing_playing',
  );
  assert.deepEqual(sent, []);
});

test('skip starts the next track from 0 and tells subscribers', async () => {
  const room = await createRoom(users.owner, { name: 'Starts' });
  const [a] = await fill(room, 'a');

  const before = Date.now();
  await skip(users.owner, room.id);
  const { playback } = (await getPlayback(users.guest, room.id)).json();
  assert.equal(playback.roomTrackId, a);
  assert.equal(playback.trackId, tracks.a);
  assert.equal(playback.playing, true);
  assert.equal(playback.positionMs, 0);
  assert.ok(Date.parse(playback.at) >= before - 1000, playback.at);

  const [event] = playbackEvents();
  assert.equal(event.to, `room:${room.id}`);
  assert.equal(event.data.roomId, room.id);
  assert.equal(event.data.playback.roomTrackId, a);
});

test('pause and seek: 204, saved with the server time, one event each', async () => {
  const room = await createRoom(users.owner, { name: 'Pause' });
  const [a] = await fill(room, 'a');
  await skip(users.owner, room.id);
  sent.length = 0;

  for (let i = 0; i < 2; i++) {
    const res = await putPlayback(users.owner, room.id, { playing: false, positionMs: 42000 });
    assert.equal(res.statusCode, 204, res.body);
    assert.equal(res.body, '');
  }
  const { playback } = (await getPlayback(users.stranger, room.id)).json();
  assert.deepEqual(
    { ...playback, at: undefined },
    { roomTrackId: a, trackId: tracks.a, playing: false, positionMs: 42000, at: undefined },
  );
  assert.match(playback.at, /Z$/);

  const events = playbackEvents();
  assert.equal(events.length, 2);
  assert.equal(events[1].data.playback.positionMs, 42000);
  assert.equal(events[1].data.playback.playing, false);
});

test('a state left by the previous track does not leak to the next one', async () => {
  const room = await createRoom(users.owner, { name: 'Stale' });
  const [, b] = await fill(room, 'a', 'b');
  await skip(users.owner, room.id);
  await putPlayback(users.owner, room.id, { playing: false, positionMs: 90000 });

  // The phone ends the track: b starts from 0, playing
  await skip(users.owner, room.id);
  const { playback } = (await getPlayback(users.owner, room.id)).json();
  assert.equal(playback.roomTrackId, b);
  assert.equal(playback.positionMs, 0);
  assert.equal(playback.playing, true);

  // Queue empty: nothing plays any more
  sent.length = 0;
  await skip(users.owner, room.id);
  assert.deepEqual((await getPlayback(users.owner, room.id)).json(), {
    playback: null,
    activeDeviceId: users.owner.deviceId,
    canControl: true,
  });
  assert.deepEqual(playbackEvents(), [
    {
      to: `room:${room.id}`,
      event: 'room.playback',
      data: { roomId: room.id, playback: null, activeDeviceId: users.owner.deviceId },
    },
  ]);
});

test('without a delegation, a member cannot report playback (403), 404 in a hidden room', async () => {
  const room = await createRoom(users.owner, { name: 'Remote', visibility: 'private' });
  await fill(room, 'a');
  await invite(users.owner, room.id, users.guest.id);
  await skip(users.owner, room.id);
  sent.length = 0;

  const state = { playing: false, positionMs: 1000 };
  assertProblem(await putPlayback(users.guest, room.id, state), 403, 'not_delegated');
  assertProblem(await putPlayback(users.stranger, room.id, state), 404, 'not_found');
  assertProblem(await getPlayback(users.stranger, room.id), 404, 'not_found');
  assert.equal((await getPlayback(users.guest, room.id)).statusCode, 200);
  assert.deepEqual(sent, []);
});

test('playback body: a negative position or a missing field is rejected', async () => {
  const room = await createRoom(users.owner, { name: 'Bad body' });
  await fill(room, 'a');
  await skip(users.owner, room.id);

  for (const payload of [
    { playing: true, positionMs: -1 },
    { playing: true, positionMs: 1.5 },
    { positionMs: 0 },
    { playing: 'yes', positionMs: 0 },
  ]) {
    assertProblem(await putPlayback(users.owner, room.id, payload), 400, 'validation_failed');
  }
});

test('deleting a room drops its playback state', async () => {
  const room = await createRoom(users.owner, { name: 'Gone' });
  await fill(room, 'a');
  await skip(users.owner, room.id);
  assert.notEqual(await app.redis.get(`playback:${room.id}`), null);

  const res = await app.inject({
    method: 'DELETE',
    url: `/v1/rooms/${room.id}`,
    headers: auth(users.owner),
  });
  assert.equal(res.statusCode, 204);
  assert.equal(await app.redis.get(`playback:${room.id}`), null);
});

// Concurrency (subject V.2.1: several people voting for the same or different tracks)

test('50 users vote for the same track at once: 50 votes', async () => {
  const room = await createRoom(users.owner, { name: 'Crowd' });
  const [id] = await fill(room, 'a');

  const results = await Promise.all(voters.map((voter) => vote(voter, room.id, id)));
  assert.deepEqual(new Set(results.map((res) => res.statusCode)), new Set([204]));
  assert.equal((await getQueue(users.owner, room.id)).json().queue[0].votes, 50);
});

test('one user votes 20 times at once: one vote', async () => {
  const room = await createRoom(users.owner, { name: 'Spam' });
  const [id] = await fill(room, 'a');

  await Promise.all(Array.from({ length: 20 }, () => vote(users.guest, room.id, id)));
  assert.equal((await getQueue(users.owner, room.id)).json().queue[0].votes, 1);
  assert.equal(sent.length, 1);
});

test('the same track proposed 10 times at once: one 201, one item', async () => {
  const room = await createRoom(users.owner, { name: 'Same track' });

  const results = await Promise.all(
    voters.slice(0, 10).map((voter) => propose(voter, room.id, tracks.a)),
  );
  assert.equal(results.filter((res) => res.statusCode === 201).length, 1);
  assert.equal(results.filter((res) => res.statusCode === 200).length, 9);
  assert.equal(new Set(results.map((res) => res.json().id)).size, 1);
  assert.equal((await getQueue(users.owner, room.id)).json().queue.length, 1);
});

test('3 skips at once run one after the other: never two tracks playing', async () => {
  const room = await createRoom(users.owner, { name: 'Skip race' });
  await fill(room, 'a', 'b', 'c');

  const results = await Promise.all([1, 2, 3].map(() => skip(users.owner, room.id)));
  assert.deepEqual(new Set(results.map((res) => res.statusCode)), new Set([200]));

  const [rows] = await app.db.query(
    'SELECT status, COUNT(*) AS n FROM room_tracks WHERE room_id = ? GROUP BY status',
    [room.id],
  );
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  assert.deepEqual(counts, { played: 2, playing: 1 });
});
