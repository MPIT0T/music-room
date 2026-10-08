import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateSocket } from '../src/utils/socket.js';
import { createTokenService } from '../src/auth/tokens.js';

const tokens = createTokenService('a'.repeat(32));

// Runs the handshake middleware on a minimal fake socket and returns what it passed to next()
async function handshake(auth) {
  const socket = { handshake: { auth }, data: {} };
  const err = await new Promise((resolve) => authenticateSocket(tokens)(socket, resolve));
  return { err, data: socket.data };
}

test('a valid access token opens the socket with the user and device ids', async () => {
  const token = await tokens.signAccessToken({ userId: 'user-1', deviceId: 'device-1' });

  const { err, data } = await handshake({ token });

  assert.equal(err, undefined);
  assert.deepEqual(data, { userId: 'user-1', deviceId: 'device-1' });
});

test('a missing or invalid token is refused with the same generic error', async () => {
  for (const auth of [undefined, {}, { token: 'forged.token.value' }]) {
    const { err, data } = await handshake(auth);

    assert.equal(err?.message, 'unauthorized');
    assert.deepEqual(data, {});
  }
});
