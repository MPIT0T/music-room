import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devBroadcastHandler } from '../src/dev/socket.js';

const ROOM_ID = '01920000-0000-7000-8000-000000000001';

// Records what the server would push, per channel
function fakeIo() {
  const sent = [];
  return {
    sent,
    to: (channel) => ({ emit: (event, data) => sent.push({ channel, event, data }) }),
  };
}

const fakeSocket = (userId, channels) => ({ data: { userId }, rooms: new Set(channels) });

function send(io, socket, payload) {
  return new Promise((resolve) => devBroadcastHandler(io, socket)(payload, resolve));
}

test('a subscribed socket broadcasts its message to the whole room', async () => {
  const io = fakeIo();
  const socket = fakeSocket('alice', [`room:${ROOM_ID}`]);

  const ack = await send(io, socket, { roomId: ROOM_ID, text: '  salut  ' });

  assert.deepEqual(ack, { ok: true });
  assert.equal(io.sent.length, 1);
  const [{ channel, event, data }] = io.sent;
  assert.equal(channel, `room:${ROOM_ID}`);
  assert.equal(event, 'dev:message');
  assert.equal(data.roomId, ROOM_ID);
  assert.equal(data.from, 'alice');
  assert.equal(data.text, 'salut');
  assert.ok(!Number.isNaN(Date.parse(data.sentAt)));
});

test('a socket that did not subscribe to the room cannot broadcast to it', async () => {
  const io = fakeIo();
  const socket = fakeSocket('mallory', ['user:mallory']);

  const ack = await send(io, socket, { roomId: ROOM_ID, text: 'hello' });

  assert.deepEqual(ack, { ok: false, code: 'NOT_SUBSCRIBED' });
  assert.equal(io.sent.length, 0);
});

test('invalid payloads are refused without broadcasting', async () => {
  const io = fakeIo();
  const socket = fakeSocket('alice', [`room:${ROOM_ID}`]);

  for (const payload of [
    undefined,
    { roomId: ROOM_ID },
    { roomId: ROOM_ID, text: '   ' },
    { roomId: ROOM_ID, text: 'x'.repeat(501) },
    { roomId: ROOM_ID, text: 'evil\u202Etext' },
    { text: 'no room' },
  ]) {
    assert.deepEqual(await send(io, socket, payload), { ok: false, code: 'INVALID' });
  }
  assert.equal(io.sent.length, 0);
});

test('a call without an ack callback does not throw', () => {
  const io = fakeIo();
  const socket = fakeSocket('alice', [`room:${ROOM_ID}`]);

  devBroadcastHandler(io, socket)({ roomId: ROOM_ID, text: 'fire and forget' });

  assert.equal(io.sent.length, 1);
});
