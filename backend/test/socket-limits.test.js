import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTokenService } from '../src/auth/tokens.js';
import { limits, MAX_SOCKETS_PER_USER } from '../src/security/limits.js';
import { authenticateSocket, handleConnection, limitConnections } from '../src/utils/socket.js';

const tokens = createTokenService('a'.repeat(32));
const ROOM_ID = '01920000-0000-7000-8000-000000000001';

// Allows a rule `max` times per value, like the real limiter with its window never ending
function fakeLimiter(max = Infinity) {
  const counts = new Map();
  return {
    consume: async (rule, value) => {
      const key = `${rule.name}|${value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { allowed: counts.get(key) <= max };
    },
  };
}

function fakeLog() {
  const lines = [];
  return { lines, warn: (fields, msg) => lines.push({ ...fields, msg }) };
}

const fakeIo = (open) => ({
  sockets: { adapter: { rooms: new Map(open ? [['user:u1', new Set(open)]] : []) } },
});

function fakeSocket() {
  const socket = new EventEmitter();
  socket.id = 's1';
  socket.data = { userId: 'u1', deviceId: 'd1' };
  socket.handshake = { headers: {}, auth: {}, address: '10.0.0.1' };
  socket.rooms = new Set();
  socket.join = () => {};
  socket.leave = () => {};
  return socket;
}

const run = (middleware, socket) => new Promise((resolve) => middleware(socket, resolve));

test('connections are refused past the limit of open sockets, and logged', async () => {
  const log = fakeLog();
  const below = Array.from({ length: MAX_SOCKETS_PER_USER - 1 }, (_, i) => `s${i}`);
  const atLimit = Array.from({ length: MAX_SOCKETS_PER_USER }, (_, i) => `s${i}`);
  const middleware = (open) =>
    limitConnections(fakeIo(open), { rateLimiter: fakeLimiter(), limits, log });

  assert.equal(await run(middleware(), fakeSocket()), undefined);
  assert.equal(await run(middleware(below), fakeSocket()), undefined);
  assert.deepEqual(log.lines, []);

  const err = await run(middleware(atLimit), fakeSocket());
  assert.equal(err.message, 'too_many_connections');
  assert.equal(log.lines[0].result, 'too_many_connections');
  assert.equal(log.lines[0].userId, 'u1');
});

test('sockets opened in a burst count each other: never more than the limit', async () => {
  const io = fakeIo();
  const middleware = limitConnections(io, { rateLimiter: fakeLimiter(), limits, log: fakeLog() });
  const opening = Array.from({ length: MAX_SOCKETS_PER_USER + 3 }, (_, i) => {
    const socket = fakeSocket();
    socket.join = (room) => {
      const rooms = io.sockets.adapter.rooms;
      rooms.set(room, (rooms.get(room) ?? new Set()).add(`s${i}`));
    };
    return run(middleware, socket);
  });

  const results = await Promise.all(opening);
  assert.equal(results.filter((err) => err == null).length, MAX_SOCKETS_PER_USER);
});

test('connections are refused past the rate limit, even with no socket open', async () => {
  const rateLimiter = fakeLimiter(limits.socketConnect.limit);
  const middleware = limitConnections(fakeIo(), { rateLimiter, limits, log: fakeLog() });

  for (let i = 0; i < limits.socketConnect.limit; i++) {
    assert.equal(await run(middleware, fakeSocket()), undefined);
  }
  assert.equal((await run(middleware, fakeSocket())).message, 'rate_limited');
});

test('subscribe is refused past the limit, without touching the database', async () => {
  const log = { child: () => log, info() {}, warn: (fields) => lines.push(fields) };
  const lines = [];
  let reads = 0;
  const db = {
    query: async () => {
      reads += 1;
      return [[]];
    },
  };
  const socket = fakeSocket();
  handleConnection(socket, { db, log, rateLimiter: fakeLimiter(1), limits });
  const subscribe = () =>
    new Promise((resolve) => socket.emit('subscribe', { roomId: ROOM_ID }, resolve));

  assert.deepEqual(await subscribe(), { ok: false, code: 'NOT_FOUND' });
  assert.deepEqual(await subscribe(), { ok: false, code: 'RATE_LIMITED' });
  assert.equal(reads, 1);
  assert.deepEqual(lines.at(-1), { roomId: ROOM_ID, result: 'rate_limited' });
});

test('refused handshakes stop being logged past the cap, and stay refused', async () => {
  const log = fakeLog();
  const middleware = authenticateSocket(tokens, log, { rateLimiter: fakeLimiter(2), limits });

  for (let i = 0; i < 5; i++) {
    const socket = fakeSocket();
    socket.data = {};
    assert.equal((await run(middleware, socket)).message, 'unauthorized');
  }
  assert.equal(log.lines.length, 2);
});

test('the log cap on refused handshakes never blocks a valid token from the same IP', async () => {
  const middleware = authenticateSocket(tokens, fakeLog(), {
    rateLimiter: fakeLimiter(0),
    limits,
  });
  const socket = fakeSocket();
  socket.data = {};
  socket.handshake.auth = {
    token: await tokens.signAccessToken({ userId: 'u1', deviceId: 'd1' }),
  };

  assert.equal(await run(middleware, socket), undefined);
  assert.equal(socket.data.userId, 'u1');
});
