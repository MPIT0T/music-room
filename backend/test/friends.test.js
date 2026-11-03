import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { areFriends } from '../src/friends/repo.js';
import { limits } from '../src/security/limits.js';

// Integration tests: real MariaDB (make test). Users are unique to this run and removed after.
const RUN = randomUUID().slice(0, 8);

let app;
const users = {};

const sent = [];
const fakeIo = {
  to: (channel) => ({ emit: (event, data) => sent.push({ to: channel, event, data }) }),
};

// Verified by default: unverified accounts cannot log in and are hidden from search
async function createUser(name, { verified = true, id = null } = {}) {
  const displayName = `friends-${RUN}-${name}`;
  const [[row]] = await app.db.query(
    `INSERT INTO users (id, display_name, email_verified_at)
     VALUES (COALESCE(?, uuid_v7()), ?, IF(?, NOW(3), NULL)) RETURNING id`,
    [id, displayName, verified],
  );
  const token = await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() });
  return { id: row.id, token, displayName };
}

before(async () => {
  // The concurrency test alone sends 20 requests: keep the hourly limit out of the way
  const friendRequest = { ...limits.friendRequest, limit: 1000 };
  app = await buildApp({ logger: false, limits: { ...limits, friendRequest } });
  app.decorate('io', fakeIo);
  for (const name of ['ann', 'bob', 'cid', 'dan']) users[name] = await createUser(name);
  users.ghost = await createUser('ghost', { verified: false });
});

beforeEach(async () => {
  sent.length = 0;
  const ids = Object.values(users).map((user) => user.id);
  await app.db.query('DELETE FROM friendships WHERE user_a IN (?) OR user_b IN (?)', [ids, ids]);
});

after(async () => {
  const ids = Object.values(users).map((user) => user.id);
  await app.db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  await app.close();
});

const auth = (user) => ({ authorization: `Bearer ${user.token}` });
const put = (actor, userId) =>
  app.inject({ method: 'PUT', url: `/v1/friends/${userId}`, headers: auth(actor) });
const del = (actor, userId) =>
  app.inject({ method: 'DELETE', url: `/v1/friends/${userId}`, headers: auth(actor) });
const get = (actor, url) => app.inject({ url, headers: auth(actor) });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.equal(res.json().code, code);
}

async function befriend(a, b) {
  assert.equal((await put(a, b.id)).json().status, 'pending');
  assert.equal((await put(b, a.id)).json().status, 'accepted');
}

test('a request stays pending until the receiver accepts it', async () => {
  const res = await put(users.ann, users.bob.id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'pending' });
  assert.equal(await areFriends(app.db, users.ann.id, users.bob.id), false);

  // The sender asking again changes nothing
  assert.deepEqual((await put(users.ann, users.bob.id)).json(), { status: 'pending' });

  assert.deepEqual((await put(users.bob, users.ann.id)).json(), { status: 'accepted' });
  assert.equal(await areFriends(app.db, users.ann.id, users.bob.id), true);
  assert.equal(await areFriends(app.db, users.bob.id, users.ann.id), true);
});

test('both users are told about each change', async () => {
  await put(users.ann, users.bob.id);
  assert.deepEqual(sent, [
    {
      to: `user:${users.ann.id}`,
      event: 'friends.changed',
      data: { userId: users.bob.id, status: 'pending' },
    },
    {
      to: `user:${users.bob.id}`,
      event: 'friends.changed',
      data: { userId: users.ann.id, status: 'pending' },
    },
  ]);
});

test('the pair is ordered the way MariaDB orders UUIDs, not JS strings', async () => {
  // JS: "00000000-ffff..." < "ffffffff-0000...", MariaDB: the opposite
  const low = await createUser('low', { id: `00000000-ffff-4000-8000-${RUN}0000` });
  const high = await createUser('high', { id: `ffffffff-0000-4000-8000-${RUN}0000` });
  users.low = low;
  users.high = high;

  assert.equal((await put(low, high.id)).statusCode, 200);
  assert.equal((await put(high, low.id)).json().status, 'accepted');
  const [rows] = await app.db.query(
    'SELECT COUNT(*) AS n FROM friendships WHERE ? IN (user_a, user_b)',
    [low.id],
  );
  assert.equal(Number(rows[0].n), 1);
});

test('crossed requests sent at the same time end as one accepted friendship', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      i % 2 ? put(users.ann, users.bob.id) : put(users.bob, users.ann.id),
    ),
  );
  for (const res of results) assert.equal(res.statusCode, 200, res.body);
  assert.equal(await areFriends(app.db, users.ann.id, users.bob.id), true);
  const [rows] = await app.db.query(
    'SELECT COUNT(*) AS n FROM friendships WHERE ? IN (user_a, user_b)',
    [users.ann.id],
  );
  assert.equal(Number(rows[0].n), 1);
});

test('lists split friends, incoming and outgoing requests', async () => {
  await befriend(users.ann, users.bob);
  await put(users.cid, users.ann.id);
  await put(users.ann, users.dan.id);

  const friends = (await get(users.ann, '/v1/friends')).json().friends;
  assert.deepEqual(friends, [
    { userId: users.bob.id, displayName: users.bob.displayName, avatarUrl: null },
  ]);

  const requests = (await get(users.ann, '/v1/friends/requests')).json();
  assert.deepEqual(
    requests.incoming.map((r) => r.userId),
    [users.cid.id],
  );
  assert.deepEqual(
    requests.outgoing.map((r) => r.userId),
    [users.dan.id],
  );
  assert.ok(!Number.isNaN(Date.parse(requests.incoming[0].createdAt)));
});

test('DELETE refuses, cancels or unfriends, and is idempotent', async () => {
  await put(users.ann, users.bob.id);
  assert.equal((await del(users.bob, users.ann.id)).statusCode, 204); // refused
  assert.equal((await put(users.ann, users.bob.id)).json().status, 'pending'); // can ask again

  await befriend(users.cid, users.dan);
  sent.length = 0;
  assert.equal((await del(users.cid, users.dan.id)).statusCode, 204);
  assert.equal(await areFriends(app.db, users.cid.id, users.dan.id), false);
  assert.equal(sent.length, 2);

  sent.length = 0;
  assert.equal((await del(users.cid, users.dan.id)).statusCode, 204);
  assert.equal(sent.length, 0);
});

test('unfriending removes delegations both ways, and only those', async () => {
  await befriend(users.ann, users.bob);
  await befriend(users.ann, users.cid);
  const device = async (owner) => {
    const id = randomUUID();
    await app.db.query(
      "INSERT INTO devices (id, user_id, name, platform) VALUES (?, ?, 'd', 'web')",
      [id, owner.id],
    );
    return id;
  };
  const annDevice = await device(users.ann);
  const bobDevice = await device(users.bob);
  await app.db.query(
    'INSERT INTO control_delegations (device_id, delegate_user_id) VALUES (?, ?), (?, ?), (?, ?)',
    [annDevice, users.bob.id, bobDevice, users.ann.id, annDevice, users.cid.id],
  );

  await del(users.bob, users.ann.id);

  const [rows] = await app.db.query(
    'SELECT device_id, delegate_user_id FROM control_delegations WHERE device_id IN (?, ?)',
    [annDevice, bobDevice],
  );
  assert.deepEqual(rows, [{ device_id: annDevice, delegate_user_id: users.cid.id }]);
});

test('errors: myself, unknown user, bad id', async () => {
  assertProblem(await put(users.ann, users.ann.id), 400, 'cannot_friend_self');
  assertProblem(await put(users.ann, randomUUID()), 404, 'user_not_found');
  assert.equal((await put(users.ann, 'not-a-uuid')).statusCode, 400);
  assert.equal((await get({ token: 'x' }, '/v1/friends')).statusCode, 401);
});

test('search: name prefix, verified only, never me, with the friendship state', async () => {
  await befriend(users.ann, users.bob);
  await put(users.cid, users.ann.id);

  const res = await get(users.ann, `/v1/users/search?q=FRIENDS-${RUN}`);
  assert.equal(res.statusCode, 200);
  const found = Object.fromEntries(res.json().users.map((u) => [u.userId, u.friendship]));
  assert.equal(found[users.ann.id], undefined);
  assert.equal(found[users.ghost.id], undefined);
  assert.equal(found[users.bob.id], 'accepted');
  assert.equal(found[users.cid.id], 'incoming');
  assert.equal(found[users.dan.id], 'none');
  assert.ok(res.json().users.every((u) => !('email' in u)));

  // LIKE wildcards are plain characters: "_" would otherwise match the "-" of every name
  const wild = await get(users.ann, `/v1/users/search?q=friends-${RUN}_`);
  assert.deepEqual(wild.json().users, []);
});
