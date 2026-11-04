import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { deviceOfflineHandler } from '../src/utils/socket.js';

// Integration tests: real MariaDB and Redis (make test). Users are unique to this run.
const RUN = randomUUID().slice(0, 8);

let app;
const users = {};
let track;

// Records what the routes send through Socket.IO; `online` holds the device:<id> channels
// that have a connected socket
const sent = [];
const online = new Set();
const fakeIo = {
  to: (channel) => ({ emit: (event, data) => sent.push({ to: channel, event, data }) }),
  in: (target) => ({
    socketsLeave: (channel) => sent.push({ in: target, leave: channel }),
    fetchSockets: async () => (online.has(target) ? [{ id: 'socket' }] : []),
  }),
};

// A user with one devices row per name; user.devices[name] = { id, token }
async function createUser(name, deviceNames = ['phone']) {
  const [[row]] = await app.db.query(
    'INSERT INTO users (display_name, email_verified_at) VALUES (?, NOW(3)) RETURNING id',
    [`deleg-${RUN}-${name}`],
  );
  const devices = {};
  for (const deviceName of deviceNames) {
    const id = randomUUID();
    await app.db.query(
      "INSERT INTO devices (id, user_id, name, platform, last_seen_at) VALUES (?, ?, ?, 'web', NOW(3))",
      [id, row.id, deviceName],
    );
    devices[deviceName] = {
      id,
      token: await app.tokens.signAccessToken({ userId: row.id, deviceId: id }),
    };
  }
  return { id: row.id, devices, token: Object.values(devices)[0].token };
}

async function befriend(a, b) {
  await app.db.query(
    `INSERT INTO friendships (user_a, user_b, requested_by, status)
     VALUES (LEAST(CAST(? AS UUID), CAST(? AS UUID)), GREATEST(CAST(? AS UUID), CAST(? AS UUID)), ?, 'accepted')`,
    [a.id, b.id, a.id, b.id, a.id],
  );
}

before(async () => {
  app = await buildApp({ logger: false });
  app.decorate('io', fakeIo);
  users.owner = await createUser('owner', ['phone', 'pc']);
  users.friend = await createUser('friend');
  users.other = await createUser('other');
  users.stranger = await createUser('stranger');
  await befriend(users.owner, users.friend);
  await befriend(users.owner, users.other);
  const [[row]] = await app.db.query(
    `INSERT INTO tracks (provider, provider_track_id, title, artist, duration_ms)
     VALUES ('jamendo', ?, 'Song', 'Artist', 180000) RETURNING id`,
    [`deleg-${RUN}`],
  );
  track = row.id;
});

beforeEach(async () => {
  sent.length = 0;
  online.clear();
  await app.db.query('DELETE FROM control_delegations WHERE device_id IN (?)', [
    Object.values(users).flatMap((user) => Object.values(user.devices).map((d) => d.id)),
  ]);
});

after(async () => {
  const ids = Object.values(users).map((user) => user.id);
  const [rooms] = await app.db.query('SELECT id FROM rooms WHERE owner_id IN (?)', [ids]);
  if (rooms.length) {
    await app.redis.del([
      ...rooms.flatMap((room) => [`playback:${room.id}`, `playback-device:${room.id}`]),
      ...Object.values(users).flatMap((user) =>
        Object.values(user.devices).map((device) => `device-rooms:${device.id}`),
      ),
    ]);
  }
  await app.db.query('DELETE FROM rooms WHERE owner_id IN (?)', [ids]);
  await app.db.query('DELETE FROM tracks WHERE id = ?', [track]);
  await app.db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  await app.close();
});

const auth = (token) => ({ authorization: `Bearer ${token}` });
const as = (user, device) => (device ? user.devices[device].token : user.token);

const request = (token, method, url, payload) =>
  app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload }) });
const grant = (token, deviceId, userId, payload) =>
  request(token, 'PUT', `/v1/devices/${deviceId}/delegations/${userId}`, payload);
const revoke = (token, deviceId, userId) =>
  request(token, 'DELETE', `/v1/devices/${deviceId}/delegations/${userId}`);

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.equal(res.json().code, code);
}

const pc = () => users.owner.devices.pc.id;
const phone = () => users.owner.devices.phone.id;

// A public room of the owner with one track playing on `device`
async function playingRoom(device = 'pc') {
  online.add(`device:${users.owner.devices[device].id}`);
  const res = await request(as(users.owner, device), 'POST', '/v1/rooms', { name: `r-${RUN}` });
  const room = res.json();
  await request(as(users.owner, device), 'POST', `/v1/rooms/${room.id}/tracks`, { trackId: track });
  await request(as(users.owner, device), 'POST', `/v1/rooms/${room.id}/skip`);
  sent.length = 0;
  return room;
}

// Devices

test('GET /v1/devices: my devices only, with current and online', async () => {
  online.add(`device:${pc()}`);
  const res = await request(as(users.owner, 'phone'), 'GET', '/v1/devices');
  assert.equal(res.statusCode, 200, res.body);
  const byName = Object.fromEntries(res.json().devices.map((d) => [d.name, d]));
  assert.deepEqual(Object.keys(byName).sort(), ['pc', 'phone']);
  assert.equal(byName.phone.current, true);
  assert.equal(byName.pc.current, false);
  assert.equal(byName.pc.online, true);
  assert.equal(byName.phone.online, false);
  assert.equal(byName.pc.ownerId, undefined);
});

test("PATCH /v1/devices/:id renames my device, 404 for someone else's", async () => {
  const res = await request(as(users.owner), 'PATCH', `/v1/devices/${pc()}`, { name: 'Salon' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().name, 'Salon');
  assertProblem(
    await request(as(users.friend), 'PATCH', `/v1/devices/${pc()}`, { name: 'Mine now' }),
    404,
    'not_found',
  );
  assertProblem(
    await request(as(users.owner), 'PATCH', `/v1/devices/${pc()}`, { name: '' }),
    400,
    'validation_failed',
  );
  await request(as(users.owner), 'PATCH', `/v1/devices/${pc()}`, { name: 'pc' });
});

// Delegations

test('the owner grants a friend, idempotent, both sides told', async () => {
  for (let i = 0; i < 2; i++) {
    const res = await grant(as(users.owner), pc(), users.friend.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().userId, users.friend.id);
    assert.equal(res.json().expiresAt, null);
  }
  const [[{ n }]] = await app.db.query(
    'SELECT COUNT(*) AS n FROM control_delegations WHERE device_id = ?',
    [pc()],
  );
  assert.equal(Number(n), 1);

  const events = sent.filter((entry) => entry.event === 'delegations.changed');
  assert.deepEqual(
    events
      .slice(0, 2)
      .map((entry) => entry.to)
      .sort(),
    [`user:${users.friend.id}`, `user:${users.owner.id}`].sort(),
  );
  assert.equal(events[0].data.status, 'granted');

  const list = await request(as(users.owner), 'GET', `/v1/devices/${pc()}/delegations`);
  assert.deepEqual(
    list.json().delegations.map((d) => d.userId),
    [users.friend.id],
  );
});

test('grant: friends only, never myself, never on a device that is not mine', async () => {
  assertProblem(await grant(as(users.owner), pc(), users.stranger.id), 403, 'not_friend');
  assertProblem(await grant(as(users.owner), pc(), users.owner.id), 400, 'cannot_delegate_self');
  assertProblem(await grant(as(users.friend), pc(), users.other.id), 404, 'not_found');
  assertProblem(await grant(as(users.owner), randomUUID(), users.friend.id), 404, 'not_found');
  assertProblem(
    await request(as(users.friend), 'GET', `/v1/devices/${pc()}/delegations`),
    404,
    'not_found',
  );
  assertProblem(
    await grant(as(users.owner), pc(), users.friend.id, { expiresAt: '2020-01-01T00:00:00Z' }),
    400,
    'expires_in_past',
  );
});

test('GET /v1/delegations: what I may control, expired ones left out', async () => {
  online.add(`device:${pc()}`);
  await grant(as(users.owner), pc(), users.friend.id);
  await app.db.query(
    `INSERT INTO control_delegations (device_id, delegate_user_id, expires_at)
     VALUES (?, ?, NOW(3) - INTERVAL 1 HOUR)`,
    [phone(), users.friend.id],
  );
  const res = await request(as(users.friend), 'GET', '/v1/delegations');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().delegations, [
    {
      deviceId: pc(),
      deviceName: 'pc',
      online: true,
      owner: { userId: users.owner.id, displayName: `deleg-${RUN}-owner`, avatarUrl: null },
      expiresAt: null,
    },
  ]);
});

test('revoke: the owner or the delegate, 404 for anyone else', async () => {
  await grant(as(users.owner), pc(), users.friend.id);
  assertProblem(await revoke(as(users.other), pc(), users.friend.id), 404, 'not_found');
  sent.length = 0;
  assert.equal((await revoke(as(users.friend), pc(), users.friend.id)).statusCode, 204);
  assert.equal(sent.filter((entry) => entry.event === 'delegations.changed').length, 2);
  // Idempotent, and nothing to tell the second time
  sent.length = 0;
  assert.equal((await revoke(as(users.owner), pc(), users.friend.id)).statusCode, 204);
  assert.deepEqual(sent, []);
});

test('unfriending removes the delegations between the two accounts', async () => {
  await grant(as(users.owner), pc(), users.other.id);
  assert.equal(
    (await request(as(users.other), 'DELETE', `/v1/friends/${users.owner.id}`)).statusCode,
    204,
  );
  const [rows] = await app.db.query(
    'SELECT 1 FROM control_delegations WHERE delegate_user_id = ?',
    [users.other.id],
  );
  assert.equal(rows.length, 0);
  await befriend(users.owner, users.other);
});

test('grant and unfriend at the same time: never a delegation left without friendship', async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.all([
      grant(as(users.owner), pc(), users.other.id),
      request(as(users.other), 'DELETE', `/v1/friends/${users.owner.id}`),
    ]);
    const [rows] = await app.db.query(
      'SELECT 1 FROM control_delegations WHERE device_id = ? AND delegate_user_id = ?',
      [pc(), users.other.id],
    );
    assert.equal(rows.length, 0, `round ${i}`);
    await befriend(users.owner, users.other);
  }
});

// Control of a room

test('a friend delegated on the playing device pauses and skips', async () => {
  const room = await playingRoom('pc');
  await grant(as(users.owner), pc(), users.friend.id);

  const state = await request(as(users.friend), 'GET', `/v1/rooms/${room.id}/playback`);
  assert.equal(state.json().activeDeviceId, pc());
  assert.equal(state.json().canControl, true);

  const res = await request(as(users.friend), 'PUT', `/v1/rooms/${room.id}/playback`, {
    playing: false,
    positionMs: 5000,
  });
  assert.equal(res.statusCode, 204, res.body);
  const event = sent.find((entry) => entry.event === 'room.playback');
  assert.equal(event.data.activeDeviceId, pc());
  assert.equal(event.data.playback.playing, false);

  assert.equal(
    (await request(as(users.friend), 'POST', `/v1/rooms/${room.id}/skip`)).statusCode,
    200,
  );
});

test('no delegation on the playing device, or an expired one: 403', async () => {
  const room = await playingRoom('pc');
  // Delegated on the phone only: the sound comes out of the PC
  await grant(as(users.owner), phone(), users.friend.id);
  const pause = { playing: false, positionMs: 0 };
  assertProblem(
    await request(as(users.friend), 'PUT', `/v1/rooms/${room.id}/playback`, pause),
    403,
    'not_delegated',
  );
  assert.equal(
    (await request(as(users.friend), 'GET', `/v1/rooms/${room.id}/playback`)).json().canControl,
    false,
  );

  await app.db.query(
    `INSERT INTO control_delegations (device_id, delegate_user_id, expires_at)
     VALUES (?, ?, NOW(3) - INTERVAL 1 MINUTE)`,
    [pc(), users.friend.id],
  );
  assertProblem(
    await request(as(users.friend), 'POST', `/v1/rooms/${room.id}/skip`),
    403,
    'delegation_expired',
  );
});

test('a delegate cannot manage the room nor move the sound', async () => {
  const room = await playingRoom('pc');
  await grant(as(users.owner), pc(), users.friend.id);
  online.add(`device:${phone()}`);
  assertProblem(
    await request(as(users.friend), 'PUT', `/v1/rooms/${room.id}/playback/device`, {
      deviceId: phone(),
    }),
    403,
    'forbidden',
  );
  assertProblem(
    await request(as(users.friend), 'PATCH', `/v1/rooms/${room.id}`, { name: 'Taken' }),
    403,
    'forbidden',
  );
});

test('transfer: the old device stops, the new one plays, friends follow the delegation', async () => {
  const room = await playingRoom('pc');
  await grant(as(users.owner), pc(), users.friend.id);

  const move = (deviceId) =>
    request(as(users.owner, 'pc'), 'PUT', `/v1/rooms/${room.id}/playback/device`, { deviceId });
  assertProblem(await move(phone()), 409, 'device_offline');
  assertProblem(await move(users.friend.devices.phone.id), 404, 'device_not_found');

  online.add(`device:${phone()}`);
  const res = await move(phone());
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().activeDeviceId, phone());
  assert.deepEqual(
    sent.find((entry) => entry.event === 'room.playback.stop'),
    { to: `device:${pc()}`, event: 'room.playback.stop', data: { roomId: room.id } },
  );
  assert.equal(sent.find((entry) => entry.event === 'room.playback').data.activeDeviceId, phone());

  // The friend only had the PC
  assertProblem(
    await request(as(users.friend), 'POST', `/v1/rooms/${room.id}/skip`),
    403,
    'not_delegated',
  );
});

test('two remotes skip the same track at once: one skip, the other gets 409 stale', async () => {
  const res = await request(as(users.owner, 'pc'), 'POST', '/v1/rooms', { name: `race-${RUN}` });
  const room = res.json();
  const extra = [];
  for (const name of ['x', 'y', 'z']) {
    const [[row]] = await app.db.query(
      `INSERT INTO tracks (provider, provider_track_id, title, artist) VALUES ('jamendo', ?, ?, 'A')
       RETURNING id`,
      [`deleg-${RUN}-${name}`, name],
    );
    extra.push(row.id);
    await request(as(users.owner), 'POST', `/v1/rooms/${room.id}/tracks`, { trackId: row.id });
  }
  const first = await request(as(users.owner, 'pc'), 'POST', `/v1/rooms/${room.id}/skip`);
  const playingId = first.json().playing.id;
  await grant(as(users.owner), pc(), users.friend.id);

  const results = await Promise.all([
    request(as(users.friend), 'POST', `/v1/rooms/${room.id}/skip`, {
      expectedRoomTrackId: playingId,
    }),
    request(as(users.owner, 'phone'), 'POST', `/v1/rooms/${room.id}/skip`, {
      expectedRoomTrackId: playingId,
    }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const [[{ n }]] = await app.db.query(
    "SELECT COUNT(*) AS n FROM room_tracks WHERE room_id = ? AND status = 'played'",
    [room.id],
  );
  assert.equal(Number(n), 1);

  await app.db.query('DELETE FROM rooms WHERE id = ?', [room.id]);
  await app.db.query('DELETE FROM tracks WHERE id IN (?)', [extra]);
});

test('device and delegation routes need an access token', async () => {
  for (const [method, url] of [
    ['GET', '/v1/devices'],
    ['PATCH', `/v1/devices/${pc()}`],
    ['GET', `/v1/devices/${pc()}/delegations`],
    ['PUT', `/v1/devices/${pc()}/delegations/${users.friend.id}`],
    ['DELETE', `/v1/devices/${pc()}/delegations/${users.friend.id}`],
    ['GET', '/v1/delegations'],
  ]) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url}`);
  }
});

// The playing device goes offline (app closed)

test('playing device offline: a friend gets 409, an owner device takes over', async () => {
  const room = await playingRoom('pc');
  await grant(as(users.owner), pc(), users.friend.id);
  online.delete(`device:${pc()}`);

  const pause = { playing: false, positionMs: 0 };
  assertProblem(
    await request(as(users.friend), 'PUT', `/v1/rooms/${room.id}/playback`, pause),
    409,
    'device_offline',
  );
  const state = await request(as(users.friend), 'GET', `/v1/rooms/${room.id}/playback`);
  assert.equal(state.json().canControl, false);

  online.add(`device:${phone()}`);
  const play = { playing: true, positionMs: 1000 };
  const res = await request(as(users.owner, 'phone'), 'PUT', `/v1/rooms/${room.id}/playback`, play);
  assert.equal(res.statusCode, 204, res.body);
  const after = await request(as(users.owner), 'GET', `/v1/rooms/${room.id}/playback`);
  assert.equal(after.json().activeDeviceId, phone());
});

test('the last socket of the playing device closes: its rooms pause where they were', async () => {
  const room = await playingRoom('pc');
  const handler = deviceOfflineHandler(fakeIo, app.redis, { data: { deviceId: pc() } }, null);

  // Another socket of the PC is still connected (second tab): nothing changes
  await handler();
  assert.equal(sent.length, 0);

  online.delete(`device:${pc()}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await handler();
  // Earlier tests left other rooms playing on the PC: they pause too, so look for this one
  const event = sent.find(
    (entry) => entry.event === 'room.playback' && entry.to === `room:${room.id}`,
  );
  assert.equal(event.data.activeDeviceId, pc());
  assert.equal(event.data.playback.playing, false);
  assert.ok(event.data.playback.positionMs >= 50, String(event.data.playback.positionMs));

  const { playback } = (
    await request(as(users.owner), 'GET', `/v1/rooms/${room.id}/playback`)
  ).json();
  assert.equal(playback.playing, false);

  // Already paused: a second disconnect sends nothing
  sent.length = 0;
  await handler();
  assert.deepEqual(sent, []);
});

test('a room moved to another device is not paused by the old one going offline', async () => {
  const room = await playingRoom('pc');
  online.add(`device:${phone()}`);
  await request(as(users.owner, 'pc'), 'PUT', `/v1/rooms/${room.id}/playback/device`, {
    deviceId: phone(),
  });
  online.delete(`device:${pc()}`);
  sent.length = 0;
  await deviceOfflineHandler(fakeIo, app.redis, { data: { deviceId: pc() } }, null)();
  assert.deepEqual(sent, []);
  // Forgotten by the index of the PC
  assert.equal((await app.redis.smembers(`device-rooms:${pc()}`)).includes(room.id), false);
});
