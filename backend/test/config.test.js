import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGoogleConfig } from '../src/config.js';

const WEB = '123-web.apps.googleusercontent.com';
const ANDROID = '123-android.apps.googleusercontent.com';

test('reads one Google client ID per platform', () => {
  const config = readGoogleConfig({ GOOGLE_CLIENT_ID_WEB: WEB, GOOGLE_CLIENT_ID_ANDROID: ANDROID });

  assert.deepEqual(config, {
    webClientId: WEB,
    androidClientId: ANDROID,
    audiences: [WEB, ANDROID],
  });
});

test('empty variables count as missing', () => {
  const config = readGoogleConfig({ GOOGLE_CLIENT_ID_WEB: WEB, GOOGLE_CLIENT_ID_ANDROID: '' });

  assert.equal(config.androidClientId, undefined);
  assert.deepEqual(config.audiences, [WEB]);
});

test('a malformed client ID stops the startup instead of failing at the first login', () => {
  assert.throws(
    () => readGoogleConfig({ GOOGLE_CLIENT_ID_WEB: 'GOCSPX-this-is-a-client-secret' }),
    /GOOGLE_CLIENT_ID_WEB/,
  );
});
