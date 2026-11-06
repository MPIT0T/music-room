import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { deleteRoom, updateRoom } from '../src/rooms/repo.js';

// Integration tests: real MariaDB (make test). Users are unique to this run and removed after.
const RUN = randomUUID().slice(0, 8);

let app;
const users = {};

// Records what the routes send through Socket.IO, without a socket server
const sent = [];
const fakeIo = {
  to: (channel) => ({ emit: (event, data) => sent.push({ to: channel, event, data }) }),
  in: (target) => ({
    socketsLeave: (channel) => sent.push({ in: target, leave: channel }),
    except: (kept) => ({
      socketsLeave: (channel) => sent.push({ in: target, except: kept, leave: channel }),
    }),
  }),
};

// Premium unless said otherwise: most tests are about rooms, not plans
async function createUser(name, plan = 'premium') {
  const [[row]] = await app.db.query(
    'INSERT INTO users (display_name, plan) VALUES (?, ?) RETURNING id',
    [`rooms-${RUN}-${name}`, plan],
  );
  const token = await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() });
  return { id: row.id, token };
}

before(async () => {
  app = await buildApp({ logger: false });
  app.decorate('io', fakeIo);
  for (const name of ['owner', 'guest', 'stranger']) users[name] = await createUser(name);
  for (const name of ['free', 'freeRace', 'freeUpgrade']) {
    users[name] = await createUser(name, 'free');
  }
});

beforeEach(() => {
  sent.length = 0;
});

after(async () => {
  const ids = Object.values(users).map((user) => user.id);
  // rooms.owner_id has no ON DELETE CASCADE: rooms go first
  await app.db.query('DELETE FROM rooms WHERE owner_id IN (?)', [ids]);
  await app.db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  await app.close();
});

const auth = (user) => ({ authorization: `Bearer ${user.token}` });

const createRoom = (user, payload) =>
  app.inject({ method: 'POST', url: '/v1/rooms', headers: auth(user), payload });

const getRoom = (user, id) => app.inject({ url: `/v1/rooms/${id}`, headers: auth(user) });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.code, code);
  return body;
}

test('POST /v1/rooms with only a name creates a public room owned by the caller', async () => {
  const res = await createRoom(users.owner, { name: '  Soirée du samedi  ' });

  assert.equal(res.statusCode, 201);
  const room = res.json();
  assert.equal(room.name, 'Soirée du samedi');
  assert.equal(room.ownerId, users.owner.id);
  assert.equal(room.description, null);
  assert.equal(room.visibility, 'public');
  assert.equal(room.accessPolicy, 'everyone');
  assert.equal(room.window, null);
  assert.equal(room.place, null);
  assert.equal(room.beaconMinor, null);
  assert.equal(room.version, 0);
  assert.equal(res.headers.etag, '"0"');
  assert.equal(res.headers.location, `/v1/rooms/${room.id}`);

  const [[row]] = await app.db.query('SELECT owner_id, name FROM rooms WHERE id = ?', [room.id]);
  assert.deepEqual(row, { owner_id: users.owner.id, name: 'Soirée du samedi' });
});

test('POST /v1/rooms stores every field, window dates and place included', async () => {
  const res = await createRoom(users.owner, {
    name: 'Concert',
    description: 'Rock only',
    visibility: 'private',
    accessPolicy: 'place_time',
    window: { start: '2026-11-01T20:00:00+01:00', end: '2026-11-02T02:00:00+01:00' },
    place: { lat: 45.7578, lng: 4.832, radiusM: 200 },
  });

  assert.equal(res.statusCode, 201);
  const room = res.json();
  assert.equal(room.description, 'Rock only');
  assert.equal(room.visibility, 'private');
  assert.equal(room.accessPolicy, 'place_time');
  assert.deepEqual(room.place, { lat: 45.7578, lng: 4.832, radiusM: 200 });
  // Sent with an offset, stored and returned in UTC
  assert.deepEqual(room.window, {
    start: '2026-11-01T19:00:00.000Z',
    end: '2026-11-02T01:00:00.000Z',
  });
});

test('POST /v1/rooms refuses invalid bodies with 400 naming the field', async () => {
  const cases = [
    [{}, 'name'],
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(101) }, 'name'],
    [{ name: 'evil\u202Eroom' }, 'name'],
    [{ name: 'Room', visibility: 'hidden' }, 'visibility'],
    [{ name: 'Room', accessPolicy: 'geo_time' }, 'accessPolicy'],
    [{ name: 'Room', accessPolicy: 'time_window' }, 'accessPolicy'],
    [{ name: 'Room', accessPolicy: 'place_time' }, 'window'],
    [{ name: 'Room', accessPolicy: 'place_time' }, 'place'],
    [{ name: 'Room', place: { lat: 91, lng: 0, radiusM: 100 } }, 'place.lat'],
    [{ name: 'Room', place: { lat: 0, lng: 0, radiusM: 1 } }, 'place.radiusM'],
    [{ name: 'Room', window: { start: 'tomorrow', end: 'later' } }, 'window.start'],
    [
      {
        name: 'Room',
        window: { start: '2026-11-01T20:00:00Z', end: '2026-11-01T20:00:00Z' },
      },
      'window.end',
    ],
  ];

  for (const [payload, path] of cases) {
    const res = await createRoom(users.owner, payload);
    const body = assertProblem(res, 400, 'validation_failed');
    assert.ok(
      body.errors.some((error) => error.path === path),
      `${JSON.stringify(payload)} should fail on ${path}, got ${JSON.stringify(body.errors)}`,
    );
  }
});

test('POST and GET /v1/rooms need an access token', async () => {
  const created = (await createRoom(users.owner, { name: 'Token test' })).json();

  const post = await app.inject({ method: 'POST', url: '/v1/rooms', payload: { name: 'x' } });
  const get = await app.inject({ url: `/v1/rooms/${created.id}` });

  assertProblem(post, 401, 'unauthorized');
  assertProblem(get, 401, 'unauthorized');
});

test('GET /v1/rooms/:id returns a public room to any signed-in user, with its ETag', async () => {
  const created = (await createRoom(users.owner, { name: 'Open room' })).json();

  const res = await getRoom(users.stranger, created.id);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), created);
  assert.equal(res.headers.etag, '"0"');
});

test('GET /v1/rooms/:id shows a private room to its owner and invited users only', async () => {
  const created = (await createRoom(users.owner, { name: 'Secret', visibility: 'private' })).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    created.id,
    users.guest.id,
  ]);

  assert.equal((await getRoom(users.owner, created.id)).statusCode, 200);
  assert.equal((await getRoom(users.guest, created.id)).statusCode, 200);
  const hidden = assertProblem(await getRoom(users.stranger, created.id), 404, 'not_found');

  // Same answer as a room that does not exist, or an id that is not even a UUID
  for (const id of [randomUUID(), 'not-a-uuid']) {
    const missing = assertProblem(await getRoom(users.stranger, id), 404, 'not_found');
    assert.equal(missing.title, hidden.title);
    assert.equal(missing.detail, hidden.detail);
  }
});

// GET /v1/rooms: other test files write rooms at the same time, so we check our own rooms only

const listRooms = (user, query = '') =>
  app.inject({ url: `/v1/rooms${query}`, headers: user ? auth(user) : {} });
const idsOf = (res) => res.json().rooms.map((room) => room.id);
// Random per run: beacon_minor is unique across all rooms in the database
const minor = () => 1000 + Math.floor(Math.random() * 64_000);

test('GET /v1/rooms: public rooms, and private ones only for their owner and members', async () => {
  const open = (await createRoom(users.owner, { name: 'Listed' })).json();
  const secret = (
    await createRoom(users.owner, { name: 'Listed secret', visibility: 'private' })
  ).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    secret.id,
    users.guest.id,
  ]);

  for (const user of [users.owner, users.guest]) {
    const ids = idsOf(await listRooms(user, '?limit=50'));
    assert.ok(ids.includes(open.id) && ids.includes(secret.id), 'owner and member see both');
  }
  const ids = idsOf(await listRooms(users.stranger, '?limit=50'));
  assert.ok(ids.includes(open.id));
  assert.ok(!ids.includes(secret.id), 'a private room is never listed to a stranger');
});

test('GET /v1/rooms: newest first, limit respected and checked', async () => {
  const res = await listRooms(users.stranger, '?limit=3');
  assert.equal(res.statusCode, 200);
  const dates = res.json().rooms.map((room) => room.createdAt);
  assert.ok(dates.length <= 3);
  assert.deepEqual(dates, [...dates].sort().reverse());

  for (const query of ['?limit=0', '?limit=51', '?limit=abc']) {
    assertProblem(await listRooms(users.stranger, query), 400, 'validation_failed');
  }
  assertProblem(await listRooms(null), 401, 'unauthorized');
});

test('GET /v1/rooms?beacon= finds the public room with that minor, else an empty list', async () => {
  const beacon = minor();
  const room = (
    await createRoom(users.owner, { name: 'Beacon party', beaconMinor: beacon })
  ).json();
  assert.equal(room.beaconMinor, beacon);

  const res = await listRooms(users.stranger, `?beacon=${beacon}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { rooms: [room] });

  // An unknown beacon (a neighbour's party, another app) is not an error
  const other = beacon === 1000 ? 1001 : beacon - 1;
  const [[taken]] = await app.db.query('SELECT COUNT(*) AS n FROM rooms WHERE beacon_minor = ?', [
    other,
  ]);
  if (Number(taken.n) === 0) {
    assert.deepEqual((await listRooms(users.stranger, `?beacon=${other}`)).json(), { rooms: [] });
  }
  for (const query of ['?beacon=-1', '?beacon=65536', '?beacon=abc']) {
    assertProblem(await listRooms(users.stranger, query), 400, 'validation_failed');
  }
});

test('a beacon never reveals a private room, not even to its members', async () => {
  const beacon = minor();
  const room = (
    await createRoom(users.owner, {
      name: 'Hidden beacon',
      visibility: 'private',
      beaconMinor: beacon,
    })
  ).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    room.id,
    users.guest.id,
  ]);

  for (const user of [users.stranger, users.guest, users.owner]) {
    assert.deepEqual((await listRooms(user, `?beacon=${beacon}`)).json(), { rooms: [] });
  }
});

test('beaconMinor: one room per minor (409 beacon_taken), the owner sets or clears it', async () => {
  const beacon = minor();
  const first = (await createRoom(users.owner, { name: 'First', beaconMinor: beacon })).json();

  assertProblem(
    await createRoom(users.guest, { name: 'Copycat', beaconMinor: beacon }),
    409,
    'beacon_taken',
  );
  const second = (await createRoom(users.owner, { name: 'Second' })).json();
  assertProblem(
    await patchRoom(users.owner, second.id, { beaconMinor: beacon }, '"0"'),
    409,
    'beacon_taken',
  );

  // Cleared on the first room, the minor is free for the second one
  const cleared = await patchRoom(users.owner, first.id, { beaconMinor: null }, '"0"');
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().beaconMinor, null);
  const moved = await patchRoom(users.owner, second.id, { beaconMinor: beacon }, '"0"');
  assert.equal(moved.statusCode, 200);
  assert.deepEqual(idsOf(await listRooms(users.stranger, `?beacon=${beacon}`)), [second.id]);

  // Only the owner sets it: someone else cannot take the beacon off the room
  assertProblem(
    await patchRoom(users.guest, second.id, { beaconMinor: null }, '"1"'),
    403,
    'forbidden',
  );
});

const patchRoom = (user, id, payload, ifMatch) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/rooms/${id}`,
    headers: { ...auth(user), ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }) },
    payload,
  });

test('PATCH /v1/rooms/:id changes only the fields sent and bumps the version', async () => {
  const created = (
    await createRoom(users.owner, { name: 'Before', description: 'kept', visibility: 'private' })
  ).json();

  const res = await patchRoom(users.owner, created.id, { name: 'After' }, '"0"');

  assert.equal(res.statusCode, 200);
  const room = res.json();
  assert.equal(room.name, 'After');
  assert.equal(room.description, 'kept');
  assert.equal(room.visibility, 'private');
  assert.equal(room.version, 1);
  assert.equal(res.headers.etag, '"1"');
  assert.deepEqual((await getRoom(users.owner, created.id)).json(), room);
});

test('PATCH /v1/rooms/:id tells subscribers, only once the write succeeded', async () => {
  const created = (await createRoom(users.owner, { name: 'Watched' })).json();

  assert.equal((await patchRoom(users.owner, created.id, { name: 'v1' }, '"0"')).statusCode, 200);
  assert.deepEqual(sent, [
    {
      to: `room:${created.id}`,
      event: 'room.changed',
      data: { roomId: created.id, version: 1, change: 'settings' },
    },
  ]);

  sent.length = 0;
  assert.equal((await patchRoom(users.owner, created.id, { name: 'v2' }, '"0"')).statusCode, 412);
  assert.equal((await patchRoom(users.guest, created.id, { name: 'v2' }, '"1"')).statusCode, 403);
  assert.equal(
    (await patchRoom(users.owner, created.id, { accessPolicy: 'place_time' }, '"1"')).statusCode,
    400,
  );
  assert.deepEqual(sent, []);
});

test('PATCH to private: only the owner and members stay subscribed', async () => {
  const created = (await createRoom(users.owner, { name: 'Going private' })).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    created.id,
    users.guest.id,
  ]);

  const res = await patchRoom(users.owner, created.id, { visibility: 'private' }, '"0"');
  assert.equal(res.statusCode, 200);
  const channel = `room:${created.id}`;
  // The change goes out first, so a stranger's app refetches and finds the room gone
  assert.deepEqual(sent, [
    {
      to: channel,
      event: 'room.changed',
      data: { roomId: created.id, version: 1, change: 'settings' },
    },
    {
      in: channel,
      except: [`user:${users.owner.id}`, `user:${users.guest.id}`],
      leave: channel,
    },
  ]);

  // Already private: nobody left to remove
  sent.length = 0;
  assert.equal(
    (await patchRoom(users.owner, created.id, { name: 'Still' }, '"1"')).statusCode,
    200,
  );
  assert.ok(sent.every((entry) => entry.leave == null));
});

test('PATCH /v1/rooms/:id can clear the description and switch to place_time', async () => {
  const created = (await createRoom(users.owner, { name: 'Party', description: 'x' })).json();

  const res = await patchRoom(
    users.owner,
    created.id,
    {
      description: null,
      accessPolicy: 'place_time',
      window: { start: '2026-12-31T21:00:00Z', end: '2027-01-01T03:00:00Z' },
      place: { lat: 45.7578, lng: 4.832, radiusM: 200 },
    },
    '"0"',
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().description, null);
  assert.equal(res.json().accessPolicy, 'place_time');
  assert.deepEqual(res.json().place, { lat: 45.7578, lng: 4.832, radiusM: 200 });
  assert.deepEqual(res.json().window, {
    start: '2026-12-31T21:00:00.000Z',
    end: '2027-01-01T03:00:00.000Z',
  });
});

test('PATCH /v1/rooms/:id needs If-Match, and refuses a stale or malformed one', async () => {
  const created = (await createRoom(users.owner, { name: 'Versioned' })).json();

  assertProblem(
    await patchRoom(users.owner, created.id, { name: 'x' }),
    428,
    'precondition_required',
  );
  for (const ifMatch of ['"7"', '0', 'W/"0"', '"abc"', '*']) {
    assertProblem(
      await patchRoom(users.owner, created.id, { name: 'x' }, ifMatch),
      412,
      'precondition_failed',
    );
  }
  assert.equal((await patchRoom(users.owner, created.id, { name: 'v1' }, '"0"')).statusCode, 200);
  // The ETag just used is now stale
  assertProblem(
    await patchRoom(users.owner, created.id, { name: 'v2' }, '"0"'),
    412,
    'precondition_failed',
  );
  assert.equal((await getRoom(users.owner, created.id)).json().name, 'v1');
});

test('two PATCH sent at once with the same ETag: one wins, the others get 412', async () => {
  const created = (await createRoom(users.owner, { name: 'Race' })).json();

  const results = await Promise.all(
    ['A', 'B', 'C', 'D', 'E'].map((name) => patchRoom(users.owner, created.id, { name }, '"0"')),
  );

  const statuses = results.map((res) => res.statusCode).sort();
  assert.deepEqual(statuses, [200, 412, 412, 412, 412]);
  const winner = results.find((res) => res.statusCode === 200).json();
  const stored = (await getRoom(users.owner, created.id)).json();
  assert.equal(stored.version, 1);
  assert.equal(stored.name, winner.name);
});

test('PATCH /v1/rooms/:id is for the owner only', async () => {
  const open = (await createRoom(users.owner, { name: 'Open' })).json();
  const secret = (await createRoom(users.owner, { name: 'Hidden', visibility: 'private' })).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    secret.id,
    users.guest.id,
  ]);

  assertProblem(await patchRoom(users.stranger, open.id, { name: 'x' }, '"0"'), 403, 'forbidden');
  assertProblem(await patchRoom(users.guest, secret.id, { name: 'x' }, '"0"'), 403, 'forbidden');
  // Cannot see it: same 404 as an unknown room, even before If-Match is looked at
  assertProblem(await patchRoom(users.stranger, secret.id, { name: 'x' }), 404, 'not_found');
  assertProblem(await patchRoom(users.owner, randomUUID(), { name: 'x' }, '"0"'), 404, 'not_found');
  const unauthenticated = await app.inject({
    method: 'PATCH',
    url: `/v1/rooms/${open.id}`,
    headers: { 'if-match': '"0"' },
    payload: { name: 'x' },
  });
  assertProblem(unauthenticated, 401, 'unauthorized');

  assert.equal((await getRoom(users.owner, open.id)).json().name, 'Open');
  assert.equal((await getRoom(users.owner, secret.id)).json().name, 'Hidden');
});

test('PATCH /v1/rooms/:id checks the rules on the room as it would be stored', async () => {
  const timed = (
    await createRoom(users.owner, {
      name: 'Timed',
      accessPolicy: 'place_time',
      window: { start: '2026-11-01T20:00:00Z', end: '2026-11-01T23:00:00Z' },
      place: { lat: 45.7578, lng: 4.832, radiusM: 200 },
    })
  ).json();
  const plain = (await createRoom(users.owner, { name: 'Plain' })).json();

  const cases = [
    [timed.id, { window: null }, 'window'],
    [timed.id, { place: null }, 'place'],
    [plain.id, { accessPolicy: 'place_time' }, 'window'],
    [plain.id, { accessPolicy: 'place_time' }, 'place'],
    [
      plain.id,
      { window: { start: '2026-11-01T20:00:00Z', end: '2026-11-01T19:00:00Z' } },
      'window.end',
    ],
    [plain.id, {}, ''],
    [plain.id, { name: '' }, 'name'],
    [plain.id, { visibility: 'hidden' }, 'visibility'],
  ];
  for (const [id, payload, path] of cases) {
    const body = assertProblem(
      await patchRoom(users.owner, id, payload, '"0"'),
      400,
      'validation_failed',
    );
    assert.ok(
      body.errors.some((error) => error.path === path),
      `${JSON.stringify(payload)} should fail on "${path}", got ${JSON.stringify(body.errors)}`,
    );
  }
  assert.equal((await getRoom(users.owner, timed.id)).json().version, 0);
  assert.equal((await getRoom(users.owner, plain.id)).json().version, 0);
});

test('updateRoom writes only if the version is still the expected one, even in a race', async () => {
  const created = (await createRoom(users.owner, { name: 'Row race' })).json();
  const asStored = { ...created, window: null, place: null };

  // Five connections race for the same row: the version check in the UPDATE picks one winner
  const results = await Promise.all(
    ['A', 'B', 'C', 'D', 'E'].map((name) =>
      updateRoom(app.db, created.id, 0, { ...asStored, name }),
    ),
  );

  const winners = results.filter((room) => room != null);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].version, 1);
  const [[row]] = await app.db.query('SELECT name, version FROM rooms WHERE id = ?', [created.id]);
  assert.deepEqual(row, { name: winners[0].name, version: 1 });
  assert.equal(await updateRoom(app.db, created.id, 0, { ...asStored, name: 'late' }), null);
});

const deleteRoomReq = (user, id) =>
  app.inject({ method: 'DELETE', url: `/v1/rooms/${id}`, headers: auth(user) });

test('DELETE /v1/rooms/:id removes the room with its members, queue and votes', async () => {
  const created = (await createRoom(users.owner, { name: 'To delete' })).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    created.id,
    users.guest.id,
  ]);
  const [[track]] = await app.db.query(
    `INSERT INTO tracks (provider, provider_track_id, title, artist)
     VALUES ('jamendo', ?, 'Song', 'Artist') RETURNING id`,
    [`rooms-${RUN}-delete`],
  );
  const [[item]] = await app.db.query(
    'INSERT INTO room_tracks (room_id, track_id, added_by) VALUES (?, ?, ?) RETURNING id',
    [created.id, track.id, users.owner.id],
  );
  await app.db.query('INSERT INTO votes (room_track_id, user_id) VALUES (?, ?)', [
    item.id,
    users.guest.id,
  ]);

  const res = await deleteRoomReq(users.owner, created.id);
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');

  assertProblem(await getRoom(users.owner, created.id), 404, 'not_found');
  const leftovers = [
    ['rooms', 'SELECT 1 FROM rooms WHERE id = ?', created.id],
    ['room_members', 'SELECT 1 FROM room_members WHERE room_id = ?', created.id],
    ['room_tracks', 'SELECT 1 FROM room_tracks WHERE room_id = ?', created.id],
    ['votes', 'SELECT 1 FROM votes WHERE room_track_id = ?', item.id],
  ];
  for (const [table, sql, id] of leftovers) {
    const [rows] = await app.db.query(sql, [id]);
    assert.equal(rows.length, 0, `${table} should be empty for the deleted room`);
  }
  await app.db.query('DELETE FROM tracks WHERE id = ?', [track.id]);
});

test('DELETE /v1/rooms/:id is for the owner only: 403 if visible, 404 if not', async () => {
  const open = (await createRoom(users.owner, { name: 'Open' })).json();
  const secret = (await createRoom(users.owner, { name: 'Hidden', visibility: 'private' })).json();
  await app.db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [
    secret.id,
    users.guest.id,
  ]);

  assertProblem(await deleteRoomReq(users.stranger, open.id), 403, 'forbidden');
  assertProblem(await deleteRoomReq(users.guest, secret.id), 403, 'forbidden');
  // A private room stays hidden: same 404 as a room that does not exist
  assertProblem(await deleteRoomReq(users.stranger, secret.id), 404, 'not_found');
  for (const id of [randomUUID(), 'not-a-uuid']) {
    assertProblem(await deleteRoomReq(users.owner, id), 404, 'not_found');
  }

  assert.equal((await getRoom(users.owner, open.id)).statusCode, 200);
  assert.equal((await getRoom(users.owner, secret.id)).statusCode, 200);
});

test('DELETE /v1/rooms/:id needs an access token, and a second DELETE gets 404', async () => {
  const created = (await createRoom(users.owner, { name: 'Twice' })).json();

  const anonymous = await app.inject({ method: 'DELETE', url: `/v1/rooms/${created.id}` });
  assert.equal(anonymous.statusCode, 401);

  assert.equal((await deleteRoomReq(users.owner, created.id)).statusCode, 204);
  assertProblem(await deleteRoomReq(users.owner, created.id), 404, 'not_found');
});

test('deleteRoom never deletes a room for someone who is not its owner', async () => {
  const created = (await createRoom(users.owner, { name: 'Guarded' })).json();

  assert.equal(await deleteRoom(app.db, created.id, users.stranger.id), false);
  assert.equal((await getRoom(users.owner, created.id)).statusCode, 200);

  const results = await Promise.all(
    [1, 2, 3].map(() => deleteRoom(app.db, created.id, users.owner.id)),
  );
  assert.equal(results.filter(Boolean).length, 1);
});

// ---------- free and premium ----------

const setPlan = (user, plan) =>
  app.inject({
    method: 'PUT',
    url: '/v1/me/subscription',
    headers: auth(user),
    payload: { plan },
  });

test('a free account hosts one public room open to everyone, nothing more', async () => {
  for (const [payload, path] of [
    { visibility: 'private' },
    { accessPolicy: 'invited' },
    { beaconMinor: minor() },
  ].map((extra) => [{ name: 'Not on free', ...extra }, Object.keys(extra)[0]])) {
    const body = assertProblem(await createRoom(users.free, payload), 403, 'premium_required');
    assert.deepEqual(
      body.errors.map((error) => error.path),
      [path],
    );
  }

  const res = await createRoom(users.free, { name: 'Free party' });
  assert.equal(res.statusCode, 201);
  assertProblem(await createRoom(users.free, { name: 'Second' }), 403, 'room_limit_reached');

  // Deleting it frees the slot
  assert.equal((await deleteRoomReq(users.free, res.json().id)).statusCode, 204);
  assert.equal((await createRoom(users.free, { name: 'Again' })).statusCode, 201);
});

test('a free account sending several creations at once still gets one room', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => createRoom(users.freeRace, { name: `Race ${i}` })),
  );
  const codes = results.map((res) => res.statusCode).sort();
  assert.deepEqual(codes, [201, 403, 403, 403, 403]);
  for (const res of results.filter((r) => r.statusCode === 403)) {
    assert.equal(res.json().code, 'room_limit_reached');
  }
});

test('PATCH by a free owner: premium values refused, the rest allowed', async () => {
  const [[{ id }]] = await app.db.query('SELECT id FROM rooms WHERE owner_id = ?', [users.free.id]);
  for (const payload of [
    { visibility: 'private' },
    { accessPolicy: 'invited' },
    { beaconMinor: minor() },
  ]) {
    assertProblem(await patchRoom(users.free, id, payload, '"0"'), 403, 'premium_required');
  }
  const res = await patchRoom(users.free, id, { name: 'Renamed', description: 'ok' }, '"0"');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().version, 1);
});

test('back on free: rooms made on premium keep their settings and can be downgraded', async () => {
  const user = users.freeUpgrade;
  assert.equal((await setPlan(user, 'premium')).statusCode, 204);
  const beacon = minor();
  const created = await createRoom(user, {
    name: 'Made on premium',
    visibility: 'private',
    accessPolicy: 'invited',
    beaconMinor: beacon,
  });
  assert.equal(created.statusCode, 201);
  const { id } = created.json();
  assert.equal((await createRoom(user, { name: 'Another' })).statusCode, 201);

  assert.equal((await setPlan(user, 'free')).statusCode, 204);
  assertProblem(await createRoom(user, { name: 'Third' }), 403, 'room_limit_reached');

  // Kept values pass, even sent again; a new premium value does not
  const renamed = await patchRoom(
    user,
    id,
    { name: 'Still private', visibility: 'private' },
    '"0"',
  );
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().beaconMinor, beacon);
  const changed = await patchRoom(user, id, { beaconMinor: minor() }, '"1"');
  assert.deepEqual(
    assertProblem(changed, 403, 'premium_required').errors.map((error) => error.path),
    ['beaconMinor'],
  );

  // Downgrading is always allowed, going back up is not
  const opened = await patchRoom(user, id, { visibility: 'public', beaconMinor: null }, '"1"');
  assert.equal(opened.statusCode, 200);
  assertProblem(
    await patchRoom(user, id, { visibility: 'private' }, '"2"'),
    403,
    'premium_required',
  );
});
