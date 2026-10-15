import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { limits } from '../src/security/limits.js';
import { FakeMusicClient } from './helpers/fake-music.js';
import { HttpProblem } from '../src/errors.js';

// Integration tests: real MariaDB and Redis (make test), fake Jamendo
const RUN = randomUUID().slice(0, 8);
const SEARCH_LIMIT = 5;

const track = (n, title, artist) => ({
  provider: 'jamendo',
  providerTrackId: `test-${RUN}-${n}`,
  title,
  artist,
  durationMs: 200000 + n,
  coverUrl: `https://cover.test/${n}.jpg`,
});
const music = new FakeMusicClient([
  track(1, `Night Drive ${RUN}`, 'Neon Coast'),
  track(2, `Night Market ${RUN}`, 'Lumen'),
  track(3, `Gone Track ${RUN}`, 'Ghost'),
]);

let app;
let user;
let rateUser;

async function createUser(name) {
  const [[row]] = await app.db.query('INSERT INTO users (display_name) VALUES (?) RETURNING id', [
    `tracks-${RUN}-${name}`,
  ]);
  const token = await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() });
  return { id: row.id, token };
}

before(async () => {
  app = await buildApp({
    logger: false,
    music,
    // Rule name unique to this run: repeated runs never add up
    limits: {
      ...limits,
      trackSearch: { ...limits.trackSearch, name: `track-search-${RUN}`, limit: SEARCH_LIMIT },
    },
  });
  user = await createUser('user');
  rateUser = await createUser('rate');
});

after(async () => {
  await app.db.query('DELETE FROM tracks WHERE provider_track_id LIKE ?', [`test-${RUN}-%`]);
  await app.db.query('DELETE FROM users WHERE id IN (?)', [[user.id, rateUser.id]]);
  const keys = await app.redis.keys(`rl:track-search-${RUN}:*`);
  if (keys.length > 0) await app.redis.del(keys);
  await app.close();
});

const auth = (u) => ({ authorization: `Bearer ${u.token}` });
const search = (u, query) =>
  app.inject({ method: 'GET', url: '/v1/tracks', query, headers: u ? auth(u) : {} });
const stream = (u, id) =>
  app.inject({ method: 'GET', url: `/v1/tracks/${id}/stream`, headers: u ? auth(u) : {} });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('search returns our ids and never the provider id', async () => {
  const res = await search(user, { q: `night`, limit: '10' });

  assert.equal(res.statusCode, 200, res.body);
  const { tracks } = res.json();
  assert.deepEqual(
    tracks.map((t) => t.title),
    [`Night Drive ${RUN}`, `Night Market ${RUN}`],
  );
  assert.deepEqual(Object.keys(tracks[0]).sort(), [
    'artist',
    'coverUrl',
    'durationMs',
    'id',
    'title',
  ]);
  assert.ok(!res.body.includes(`test-${RUN}`));
  assert.deepEqual(music.calls.at(-1), ['search', 'night', 10]);
});

test('searching twice keeps the same ids and refreshes the metadata', async () => {
  const first = (await search(user, { q: 'Night Drive' })).json().tracks[0];
  music.catalog[0].artist = 'Neon Coast (renamed)';

  const second = (await search(user, { q: 'Night Drive' })).json().tracks[0];

  assert.equal(second.id, first.id);
  assert.equal(second.artist, 'Neon Coast (renamed)');
  const [[{ n }]] = await app.db.query(
    'SELECT COUNT(*) AS n FROM tracks WHERE provider_track_id = ?',
    [`test-${RUN}-1`],
  );
  assert.equal(Number(n), 1);
});

test('no result is an empty list, not an error', async () => {
  const res = await search(user, { q: `nothing-${RUN}` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { tracks: [] });
});

test('search validates its query and needs a token', async () => {
  assertProblem(await search(user, {}), 400, 'validation_failed');
  assertProblem(await search(user, { q: '   ' }), 400, 'validation_failed');
  assertProblem(await search(user, { q: 'x', limit: '51' }), 400, 'validation_failed');
  assert.equal((await search(null, { q: 'night' })).statusCode, 401);
});

test('search is rate limited per user', async () => {
  for (let i = 0; i < SEARCH_LIMIT; i++) {
    assert.equal((await search(rateUser, { q: 'night' })).statusCode, 200);
  }
  const res = await search(rateUser, { q: 'night' });
  assertProblem(res, 429, 'rate_limited');
  assert.ok(Number(res.headers['retry-after']) > 0);
});

test('stream returns a fresh URL from the provider, never cached', async () => {
  const { id } = (await search(user, { q: 'Night Market' })).json().tracks[0];

  const res = await stream(user, id);

  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.json().url, new RegExp(`^https://stream\\.test/test-${RUN}-2\\.mp3`));
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(music.calls.at(-1), ['getStreamUrl', `test-${RUN}-2`]);
});

test('stream: unknown id is 404, a track the provider dropped is 410', async () => {
  assertProblem(await stream(user, randomUUID()), 404, 'track_not_found');
  assertProblem(await stream(user, 'not-a-uuid'), 404, 'track_not_found');

  const { id } = (await search(user, { q: 'Gone Track' })).json().tracks[0];
  music.catalog.splice(2, 1);
  assertProblem(await stream(user, id), 410, 'track_unavailable');
  assert.equal((await stream(null, id)).statusCode, 401);
});

test('provider errors reach the client as problem+json', async () => {
  const original = music.search;
  music.search = async () => {
    throw new HttpProblem(502, 'music_provider_error');
  };
  try {
    assertProblem(await search(user, { q: 'night' }), 502, 'music_provider_error');
  } finally {
    music.search = original;
  }
});
