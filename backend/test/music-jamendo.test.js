import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JamendoClient } from '../src/music/jamendo.js';
import { readMusicConfig } from '../src/config.js';
import { HttpProblem } from '../src/errors.js';

const RAW = {
  id: 1886257,
  name: 'Night Drive',
  artist_name: 'Neon Coast',
  duration: 214,
  album_image: 'https://usercontent.jamendo.com/album.jpg',
  image: 'https://usercontent.jamendo.com/track.jpg',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32',
};

// Records each request and answers with the next queued body
function fakeFetch(...bodies) {
  const requests = [];
  const fetch = async (url) => {
    requests.push(new URL(url));
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    if (body instanceof Error) throw body;
    if (typeof body === 'number') return { ok: false, status: body };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, requests };
}

const success = (results) => ({
  headers: { status: 'success', results_count: results.length },
  results,
});
const silentLog = () => {
  const lines = [];
  return { lines, warn: (obj, msg) => lines.push({ ...obj, msg }) };
};

test('search maps Jamendo fields to the common track shape', async () => {
  const { fetch, requests } = fakeFetch(success([RAW]));
  const music = new JamendoClient({ clientId: 'abc123', fetch });

  const tracks = await music.search('night', { limit: 5 });

  assert.deepEqual(tracks, [
    {
      provider: 'jamendo',
      providerTrackId: '1886257',
      title: 'Night Drive',
      artist: 'Neon Coast',
      durationMs: 214000,
      coverUrl: 'https://usercontent.jamendo.com/album.jpg',
    },
  ]);
  const params = requests[0].searchParams;
  assert.equal(requests[0].pathname, '/v3.0/tracks/');
  assert.equal(params.get('client_id'), 'abc123');
  assert.equal(params.get('search'), 'night');
  assert.equal(params.get('limit'), '5');
});

test('tracks without audio are never offered', async () => {
  const { fetch } = fakeFetch(
    success([
      { ...RAW, audio: '' },
      { ...RAW, id: 2 },
    ]),
  );
  const music = new JamendoClient({ clientId: 'abc123', fetch });

  const tracks = await music.search('night');

  assert.deepEqual(
    tracks.map((t) => t.providerTrackId),
    ['2'],
  );
});

test('getTrack and getStreamUrl look the track up by id, null when unknown', async () => {
  const { fetch, requests } = fakeFetch(success([RAW]), success([RAW]), success([]));
  const music = new JamendoClient({ clientId: 'abc123', fetch });

  assert.equal((await music.getTrack('1886257')).title, 'Night Drive');
  assert.equal(await music.getStreamUrl('1886257'), RAW.audio);
  assert.equal(await music.getTrack('999'), null);
  assert.equal(requests[0].searchParams.get('id'), '1886257');
});

test('an error inside an HTTP 200 becomes a 502 without leaking the Jamendo message', async () => {
  const { fetch } = fakeFetch({
    headers: { status: 'failed', error_message: 'Invalid client_id abc123' },
  });
  const log = silentLog();
  const music = new JamendoClient({ clientId: 'abc123', fetch, log });

  await assert.rejects(music.search('night'), (err) => {
    assert.ok(err instanceof HttpProblem);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'music_provider_error');
    assert.ok(!err.detail.includes('abc123'));
    assert.match(err.cause.message, /Invalid client_id/);
    return true;
  });
  // the path is logged, never the URL (it carries the client_id)
  assert.equal(log.lines[0].path, '/tracks/');
  assert.ok(!JSON.stringify(log.lines).includes('client_id='));
});

test('HTTP and network failures become a 502 as well', async () => {
  for (const failure of [500, new Error('ECONNRESET')]) {
    const { fetch } = fakeFetch(failure);
    const music = new JamendoClient({ clientId: 'abc123', fetch, log: silentLog() });
    await assert.rejects(music.getTrack('1'), { status: 502, code: 'music_provider_error' });
  }
});

test('topTracks retries when Jamendo answers success with too few results', async () => {
  const { fetch, requests } = fakeFetch(success([]), success([RAW, { ...RAW, id: 2 }]));
  const music = new JamendoClient({ clientId: 'abc123', fetch });

  const tracks = await music.topTracks('rock', { limit: 2, retryDelayMs: 0 });

  assert.equal(tracks.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get('tags'), 'rock');
});

test('topTracks gives up after the last attempt and returns what it has', async () => {
  const { fetch, requests } = fakeFetch(success([RAW]));
  const music = new JamendoClient({ clientId: 'abc123', fetch });

  const tracks = await music.topTracks('rock', { limit: 2, attempts: 3, retryDelayMs: 0 });

  assert.equal(tracks.length, 1);
  assert.equal(requests.length, 3);
});

test('without a client ID every call answers 503 and nothing is fetched', async () => {
  const { fetch, requests } = fakeFetch(success([RAW]));
  const music = new JamendoClient({
    clientId: readMusicConfig({ JAMENDO_CLIENT_ID: '' }).jamendoClientId,
    fetch,
  });

  for (const call of [music.search('x'), music.getTrack('1'), music.getStreamUrl('1')]) {
    await assert.rejects(call, { status: 503, code: 'music_unavailable' });
  }
  assert.equal(requests.length, 0);
});

test('a malformed client ID stops the startup', () => {
  assert.throws(
    () => readMusicConfig({ JAMENDO_CLIENT_ID: 'not a valid id' }),
    /JAMENDO_CLIENT_ID/,
  );
});
