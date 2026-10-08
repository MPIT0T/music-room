import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { createTokenService, InvalidTokenError } from '../src/auth/tokens.js';

const SECRET = 'a'.repeat(32);
const tokens = createTokenService(SECRET);
const ids = { userId: '0192f3a4-0000-7000-8000-000000000001', deviceId: 'device-1' };

// Builds a token by hand to simulate what an attacker could forge
function forge({
  secret = SECRET,
  alg = 'HS256',
  claims = { did: ids.deviceId },
  exp = '15m',
} = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setSubject(ids.userId)
    .setIssuer('music-room')
    .setAudience('music-room-api')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

test('a signed access token round-trips to userId and deviceId', async () => {
  const token = await tokens.signAccessToken(ids);

  assert.deepEqual(await tokens.verifyAccessToken(token), ids);
});

test('rejects a short secret at startup', () => {
  assert.throws(() => createTokenService('change_me'), /at least 32/);
  assert.throws(() => createTokenService(''), /at least 32/);
});

test('rejects tokens signed with another secret, expired, or unsigned', async () => {
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ sub: ids.userId, did: ids.deviceId }),
  ).toString('base64url')}.`;
  const cases = {
    'other secret': await forge({ secret: 'b'.repeat(32) }),
    expired: await forge({ exp: Math.floor(Date.now() / 1000) - 10 }),
    'alg none': unsigned,
    'missing did': await forge({ claims: {} }),
    garbage: 'not.a.jwt',
    empty: '',
    'not a string': 42,
    oversized: 'a'.repeat(5000),
  };

  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(tokens.verifyAccessToken(token), InvalidTokenError, name);
  }
});
