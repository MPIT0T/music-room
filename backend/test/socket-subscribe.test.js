import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeHandler } from '../src/utils/socket.js';

const PUBLIC_ID = '01920000-0000-7000-8000-000000000001';
const PRIVATE_ID = '01920000-0000-7000-8000-000000000002';
const MISSING_ID = '01920000-0000-7000-8000-000000000003';

const baseRow = {
  owner_id: 'owner',
  name: 'r',
  access_policy: 'everyone',
  starts_at: null,
  version: '5',
};

// Fake pool: knows one public room and one private room where only the user 'invited' has a room_members row
const db = {
  query: async (_sql, [userId, roomId]) => {
    if (roomId === PUBLIC_ID)
      return [[{ ...baseRow, id: PUBLIC_ID, visibility: 'public', is_invited: 0 }]];
    if (roomId === PRIVATE_ID)
      return [
        [
          {
            ...baseRow,
            id: PRIVATE_ID,
            visibility: 'private',
            is_invited: userId === 'invited' ? 1 : 0,
          },
        ],
      ];
    return [[]];
  },
};

function fakeSocket(userId) {
  const joined = [];
  return { data: { userId }, joined, join: (room) => joined.push(room) };
}

async function subscribe(socket, payload, database = db) {
  return new Promise((resolve) => subscribeHandler(socket, database)(payload, resolve));
}

test('subscribe to a public room joins room:<id> and returns its version', async () => {
  const socket = fakeSocket('stranger');
  assert.deepEqual(await subscribe(socket, { roomId: PUBLIC_ID }), { ok: true, version: 5 });
  assert.deepEqual(socket.joined, [`room:${PUBLIC_ID}`]);
});

test('private room: invited user and owner join, others get NOT_FOUND', async () => {
  for (const userId of ['invited', 'owner']) {
    const socket = fakeSocket(userId);
    assert.equal((await subscribe(socket, { roomId: PRIVATE_ID })).ok, true);
  }
  const stranger = fakeSocket('stranger');
  assert.deepEqual(await subscribe(stranger, { roomId: PRIVATE_ID }), {
    ok: false,
    code: 'NOT_FOUND',
  });
  assert.deepEqual(stranger.joined, []);
});

test('private, unknown and malformed ids all get the same NOT_FOUND', async () => {
  for (const payload of [
    { roomId: PRIVATE_ID },
    { roomId: MISSING_ID },
    { roomId: 'abc' },
    {},
    undefined,
  ]) {
    const socket = fakeSocket('stranger');
    assert.deepEqual(await subscribe(socket, payload), { ok: false, code: 'NOT_FOUND' });
    assert.deepEqual(socket.joined, []);
  }
});

test('a database error answers INTERNAL and joins nothing', async () => {
  const broken = { query: async () => Promise.reject(new Error('db down')) };
  const socket = fakeSocket('stranger');
  assert.deepEqual(await subscribe(socket, { roomId: PUBLIC_ID }, broken), {
    ok: false,
    code: 'INTERNAL',
  });
  assert.deepEqual(socket.joined, []);
});

test('a client without an ack callback does not crash the handler', async () => {
  await subscribeHandler(fakeSocket('stranger'), db)({ roomId: PUBLIC_ID });
});
