import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { addMember, removeMember } from '../src/rooms/repo.js';

// Integration tests: real MariaDB (make test). Users are unique to this run and removed after.
const RUN = randomUUID().slice(0, 8);

let app;
const users = {};

// Records what the routes send through Socket.IO, without a socket server
const sent = [];
const fakeIo = {
  to: (channel) => ({ emit: (event, data) => sent.push({ to: channel, event, data }) }),
  in: (target) => ({ socketsLeave: (channel) => sent.push({ in: target, leave: channel }) }),
};

async function createUser(name) {
  const [[row]] = await app.db.query('INSERT INTO users (display_name) VALUES (?) RETURNING id', [
    `members-${RUN}-${name}`,
  ]);
  const token = await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() });
  return { id: row.id, token, displayName: `members-${RUN}-${name}` };
}

before(async () => {
  app = await buildApp({ logger: false });
  app.decorate('io', fakeIo);
  for (const name of ['owner', 'guest', 'other', 'stranger']) users[name] = await createUser(name);
});

beforeEach(() => {
  sent.length = 0;
});

after(async () => {
  const ids = Object.values(users).map((user) => user.id);
  await app.db.query('DELETE FROM rooms WHERE owner_id IN (?)', [ids]);
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
const remove = (actor, roomId, userId) =>
  app.inject({
    method: 'DELETE',
    url: `/v1/rooms/${roomId}/members/${userId}`,
    headers: auth(actor),
  });
const members = (actor, roomId) =>
  app.inject({ url: `/v1/rooms/${roomId}/members`, headers: auth(actor) });
const getRoom = (actor, roomId) => app.inject({ url: `/v1/rooms/${roomId}`, headers: auth(actor) });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

const memberIds = async (actor, roomId) =>
  (await members(actor, roomId)).json().members.map((member) => member.userId);

test('the owner invites a user by id, friend or not: they can now see the private room', async () => {
  const room = await createRoom(users.owner, { name: 'Secret', visibility: 'private' });
  assertProblem(await getRoom(users.guest, room.id), 404, 'not_found');

  const res = await invite(users.owner, room.id, users.guest.id);
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');

  assert.equal((await getRoom(users.guest, room.id)).statusCode, 200);
  const list = (await members(users.guest, room.id)).json().members;
  assert.equal(list.length, 1);
  assert.equal(list[0].userId, users.guest.id);
  assert.equal(list[0].displayName, users.guest.displayName);
  assert.match(list[0].joinedAt, /Z$/);

  assert.deepEqual(sent, [
    {
      to: `room:${room.id}`,
      event: 'room.changed',
      data: { roomId: room.id, version: room.version, change: 'members' },
    },
  ]);
});

test('inviting twice is idempotent: 204 again, one row, no second event', async () => {
  const room = await createRoom(users.owner, { name: 'Twice' });
  assert.equal((await invite(users.owner, room.id, users.guest.id)).statusCode, 204);
  sent.length = 0;

  assert.equal((await invite(users.owner, room.id, users.guest.id)).statusCode, 204);
  assert.deepEqual(await memberIds(users.owner, room.id), [users.guest.id]);
  assert.deepEqual(sent, []);
});

test('only the owner invites: 403 for a member or a stranger of a public room', async () => {
  const room = await createRoom(users.owner, { name: 'Owner only' });
  await invite(users.owner, room.id, users.guest.id);

  assertProblem(await invite(users.guest, room.id, users.other.id), 403, 'forbidden');
  assertProblem(await invite(users.stranger, room.id, users.stranger.id), 403, 'forbidden');
  assert.deepEqual(await memberIds(users.owner, room.id), [users.guest.id]);
});

test('a private room stays hidden: 404 on every members route for a stranger', async () => {
  const room = await createRoom(users.owner, { name: 'Hidden', visibility: 'private' });
  await invite(users.owner, room.id, users.guest.id);

  assertProblem(await members(users.stranger, room.id), 404, 'not_found');
  assertProblem(await invite(users.stranger, room.id, users.stranger.id), 404, 'not_found');
  assertProblem(await remove(users.stranger, room.id, users.guest.id), 404, 'not_found');
  assertProblem(await remove(users.stranger, room.id, users.stranger.id), 404, 'not_found');
  for (const id of [randomUUID(), 'not-a-uuid']) {
    assertProblem(await invite(users.owner, id, users.guest.id), 404, 'not_found');
  }
});

test('a public room shows its members to any signed-in user', async () => {
  const room = await createRoom(users.owner, { name: 'Open' });
  await invite(users.owner, room.id, users.guest.id);
  assert.deepEqual(await memberIds(users.stranger, room.id), [users.guest.id]);
});

test('invite refuses an unknown user (404), the owner (409) and a malformed id (400)', async () => {
  const room = await createRoom(users.owner, { name: 'Bad invites' });

  assertProblem(await invite(users.owner, room.id, randomUUID()), 404, 'user_not_found');
  assertProblem(await invite(users.owner, room.id, users.owner.id), 409, 'is_owner');
  assertProblem(await invite(users.owner, room.id, 'not-a-uuid'), 400, 'validation_failed');
  assert.deepEqual(await memberIds(users.owner, room.id), []);
  assert.deepEqual(sent, []);
});

test('the owner removes a member of a private room: the room and its live feed are gone for them', async () => {
  const room = await createRoom(users.owner, { name: 'Kick', visibility: 'private' });
  await invite(users.owner, room.id, users.guest.id);
  sent.length = 0;

  assert.equal((await remove(users.owner, room.id, users.guest.id)).statusCode, 204);
  assertProblem(await getRoom(users.guest, room.id), 404, 'not_found');
  assert.deepEqual(sent, [
    { in: `user:${users.guest.id}`, leave: `room:${room.id}` },
    {
      to: `room:${room.id}`,
      event: 'room.changed',
      data: { roomId: room.id, version: room.version, change: 'members' },
    },
  ]);
});

test('removed from a public room: still sees it, keeps the live feed', async () => {
  const room = await createRoom(users.owner, { name: 'Public kick' });
  await invite(users.owner, room.id, users.guest.id);
  sent.length = 0;

  assert.equal((await remove(users.owner, room.id, users.guest.id)).statusCode, 204);
  assert.equal((await getRoom(users.guest, room.id)).statusCode, 200);
  assert.deepEqual(
    sent.map((entry) => entry.event ?? 'leave'),
    ['room.changed'],
  );
});

test('a member can leave on their own, but cannot remove someone else', async () => {
  const room = await createRoom(users.owner, { name: 'Leave', visibility: 'private' });
  await invite(users.owner, room.id, users.guest.id);
  await invite(users.owner, room.id, users.other.id);

  assertProblem(await remove(users.guest, room.id, users.other.id), 403, 'forbidden');
  assert.equal((await remove(users.guest, room.id, users.guest.id)).statusCode, 204);
  assert.deepEqual(await memberIds(users.owner, room.id), [users.other.id]);
});

test('removing someone who is not a member is idempotent: 204, no event', async () => {
  const room = await createRoom(users.owner, { name: 'Nobody' });

  assert.equal((await remove(users.owner, room.id, users.stranger.id)).statusCode, 204);
  assert.equal((await remove(users.owner, room.id, randomUUID())).statusCode, 204);
  assert.deepEqual(sent, []);
});

test('members routes need an access token', async () => {
  const room = await createRoom(users.owner, { name: 'Token' });
  for (const [method, url] of [
    ['GET', `/v1/rooms/${room.id}/members`],
    ['PUT', `/v1/rooms/${room.id}/members/${users.guest.id}`],
    ['DELETE', `/v1/rooms/${room.id}/members/${users.guest.id}`],
  ]) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url}`);
  }
});

test('addMember and removeMember stay consistent when the same call runs in parallel', async () => {
  const room = await createRoom(users.owner, { name: 'Race' });

  const added = await Promise.all(
    [1, 2, 3, 4, 5].map(() => addMember(app.db, room.id, users.guest.id)),
  );
  assert.equal(added.filter(Boolean).length, 1);

  const removed = await Promise.all(
    [1, 2, 3].map(() => removeMember(app.db, room.id, users.guest.id)),
  );
  assert.equal(removed.filter(Boolean).length, 1);
  assert.deepEqual(await memberIds(users.owner, room.id), []);
});

test('deleting a room removes its members', async () => {
  const room = await createRoom(users.owner, { name: 'Gone' });
  await invite(users.owner, room.id, users.guest.id);
  sent.length = 0;

  const res = await app.inject({
    method: 'DELETE',
    url: `/v1/rooms/${room.id}`,
    headers: auth(users.owner),
  });
  assert.equal(res.statusCode, 204);
  const [rows] = await app.db.query('SELECT 1 FROM room_members WHERE room_id = ?', [room.id]);
  assert.equal(rows.length, 0);
  assert.deepEqual(sent, [
    {
      to: `room:${room.id}`,
      event: 'room.changed',
      data: { roomId: room.id, version: room.version + 1, change: 'deleted' },
    },
    { in: `room:${room.id}`, leave: `room:${room.id}` },
  ]);
});
