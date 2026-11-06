import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { createTokenService } from '../src/auth/tokens.js';
import { loggerOptions } from '../src/logger.js';
import { authenticateSocket, handleConnection } from '../src/utils/socket.js';

const USER_AGENT = 'MusicRoom/1.2.3 (android; Pixel 8)';
const ROOM_ID = '01920000-0000-7000-8000-000000000001';
const tokens = createTokenService('a'.repeat(32));
const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };

// The real logger configuration, writing into memory instead of stdout
async function capturedLog(t) {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: loggerOptions({ stream }) });
  t.after(() => app.close());
  const raw = () => chunks.join('');
  const lines = () =>
    raw()
      .trim()
      .split('\n')
      .filter((line) => line.includes('"msg":"socket'))
      .map((line) => JSON.parse(line));
  return { log: app.log, raw, lines };
}

function fakeSocket(headers = { 'user-agent': USER_AGENT }) {
  const socket = new EventEmitter();
  socket.id = 'socket-1';
  socket.data = { userId: 'user-1', deviceId: 'device-1' };
  socket.handshake = { headers, auth: {} };
  socket.rooms = new Set();
  socket.join = (rooms) => [rooms].flat().forEach((room) => socket.rooms.add(room));
  socket.leave = (room) => socket.rooms.delete(room);
  return socket;
}

// Fake pool: one public room, every other id is unknown
const db = {
  query: async (_sql, [, roomId]) =>
    roomId === ROOM_ID
      ? [
          [
            {
              id: ROOM_ID,
              owner_id: 'owner',
              name: 'r',
              visibility: 'public',
              access_policy: 'everyone',
              starts_at: null,
              version: '5',
              is_invited: 0,
            },
          ],
        ]
      : [[]],
};
const brokenDb = {
  query: async () => {
    throw new Error('db down');
  },
};

const emit = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

test('connection and disconnection are logged with who, which device and which app', async (t) => {
  const { log, lines } = await capturedLog(t);
  const socket = fakeSocket();

  handleConnection(socket, { db, log });
  socket.emit('disconnect', 'transport close');

  const [connected, disconnected] = lines();
  for (const line of [connected, disconnected]) {
    assert.equal(line.socketId, 'socket-1');
    assert.equal(line.userId, 'user-1');
    assert.equal(line.deviceId, 'device-1');
    assert.equal(line.platform, 'android');
    assert.equal(line.model, 'Pixel 8');
    assert.equal(line.appVersion, '1.2.3');
  }
  assert.equal(connected.msg, 'socket connected');
  assert.equal(connected.result, 'ok');
  assert.equal(disconnected.msg, 'socket disconnected');
  assert.equal(disconnected.reason, 'transport close');
  assert.equal(typeof disconnected.durationMs, 'number');
});

test('a client without our User-Agent is logged as unknown, not dropped', async (t) => {
  const { log, lines } = await capturedLog(t);

  handleConnection(fakeSocket({}), { db, log });

  const [connected] = lines();
  assert.equal(connected.platform, 'unknown');
  assert.equal(connected.appVersion, 'unknown');
});

test('subscribe logs its result: ok, not_found, error', async (t) => {
  const { log, lines } = await capturedLog(t);
  const socket = fakeSocket();
  handleConnection(socket, { db, log });

  await emit(socket, 'subscribe', { roomId: ROOM_ID });
  await emit(socket, 'subscribe', { roomId: 'unknown-room' });

  const failing = fakeSocket();
  handleConnection(failing, { db: brokenDb, log });
  await emit(failing, 'subscribe', { roomId: ROOM_ID });

  const subscribes = lines().filter((line) => line.msg === 'socket subscribe');
  assert.deepEqual(
    subscribes.map(({ roomId, result, level }) => ({ roomId, result, level })),
    [
      { roomId: ROOM_ID, result: 'ok', level: 30 },
      { roomId: 'unknown-room', result: 'not_found', level: 40 },
      { roomId: ROOM_ID, result: 'error', level: 50 },
    ],
  );
  assert.equal(subscribes[0].userId, 'user-1');
  assert.equal(subscribes[0].deviceId, 'device-1');
});

test('unsubscribe logs its result: ok, not_subscribed, invalid', async (t) => {
  const { log, lines } = await capturedLog(t);
  const socket = fakeSocket();
  handleConnection(socket, { db, log });
  await emit(socket, 'subscribe', { roomId: ROOM_ID });

  socket.emit('unsubscribe', { roomId: ROOM_ID });
  socket.emit('unsubscribe', { roomId: ROOM_ID });
  socket.emit('unsubscribe', { roomId: 42 });

  assert.equal(socket.rooms.has(`room:${ROOM_ID}`), false);
  assert.deepEqual(
    lines()
      .filter((line) => line.msg === 'socket unsubscribe')
      .map(({ roomId, result }) => ({ roomId, result })),
    [
      { roomId: ROOM_ID, result: 'ok' },
      { roomId: ROOM_ID, result: 'not_subscribed' },
      { roomId: 'unknown', result: 'invalid' },
    ],
  );
});

test('a roomId sent by the client is bounded and cleaned before it reaches the logs', async (t) => {
  const { log, lines } = await capturedLog(t);
  const socket = fakeSocket();
  handleConnection(socket, { db, log });

  await emit(socket, 'subscribe', { roomId: `evil\n${'x'.repeat(5000)}` });

  const [line] = lines().filter((entry) => entry.msg === 'socket subscribe');
  assert.equal(line.result, 'not_found');
  assert.equal(line.roomId.length, 64);
  assert.ok(!line.roomId.includes('\n'));
});

test('no token ever reaches the logs: valid, expired or forged handshake', async (t) => {
  const { log, raw, lines } = await capturedLog(t);
  const valid = await tokens.signAccessToken({ userId: 'user-1', deviceId: 'device-1' });
  const forged = `${valid.slice(0, -4)}AAAA`;

  for (const token of [valid, forged, 'not-a-token', undefined]) {
    const socket = fakeSocket();
    socket.data = {};
    socket.handshake.auth = { token };
    const err = await new Promise((resolve) => authenticateSocket(tokens, log)(socket, resolve));
    if (err == null) {
      handleConnection(socket, { db, log });
      socket.emit('disconnect', 'client namespace disconnect');
    }
  }

  const rejected = lines().filter((line) => line.msg === 'socket handshake rejected');
  assert.equal(rejected.length, 3);
  for (const line of rejected) {
    assert.equal(line.result, 'rejected');
    assert.equal(line.platform, 'android');
    assert.equal(typeof line.reason, 'string');
  }
  assert.ok(!raw().includes(valid));
  assert.ok(!raw().includes(forged));
  assert.ok(!raw().includes('not-a-token'));
});
