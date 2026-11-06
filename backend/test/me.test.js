import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';

// Integration tests: real MariaDB (make test). Users, genres and friendships are created directly.
const RUN = randomUUID().slice(0, 8);
const email = (name) => `me-${RUN}-${name}@example.com`;
// Characters built from code points: the source file itself stays free of invisible characters
const RLO = String.fromCodePoint(0x202e);

let app;
const users = {};
const genres = {};

async function createUser(name, extra = {}) {
  const [[row]] = await app.db.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name, city, phone, real_name, birth_date)
     VALUES (?, 'x', NOW(3), ?, ?, ?, ?, ?) RETURNING id`,
    [
      email(name),
      name,
      extra.city ?? null,
      extra.phone ?? null,
      extra.realName ?? null,
      extra.birthDate ?? null,
    ],
  );
  users[name] = {
    id: row.id,
    token: await app.tokens.signAccessToken({ userId: row.id, deviceId: randomUUID() }),
  };
}

// The table enforces user_a < user_b with MariaDB's own UUID order: try both
async function befriend(a, b, status = 'accepted') {
  const [x, y] = [users[a].id, users[b].id];
  try {
    await app.db.query(
      'INSERT INTO friendships (user_a, user_b, requested_by, status) VALUES (?, ?, ?, ?)',
      [x, y, x, status],
    );
  } catch {
    await app.db.query(
      'INSERT INTO friendships (user_a, user_b, requested_by, status) VALUES (?, ?, ?, ?)',
      [y, x, x, status],
    );
  }
}

before(async () => {
  app = await buildApp({ logger: false });
  for (const name of ['Jazz', 'Rock', 'Ambient']) {
    const [result] = await app.db.query('INSERT INTO genres (name) VALUES (?)', [`${name}-${RUN}`]);
    genres[name] = Number(result.insertId);
  }
  await createUser('max', {
    city: 'Paris',
    phone: '+33 6 00 00 00 00',
    realName: 'Maximilien B.',
    birthDate: '1999-04-12',
  });
  await createUser('friend');
  await createUser('pending');
  await createUser('stranger');
  await befriend('max', 'friend');
  await befriend('max', 'pending', 'pending');
});

after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`me-${RUN}-%`]);
  await app.db.query('DELETE FROM genres WHERE name LIKE ?', [`%-${RUN}`]);
  await app.close();
});

const call = (method, url, who, payload) =>
  app.inject({
    method,
    url,
    payload,
    headers: who ? { authorization: `Bearer ${users[who].token}` } : {},
  });
const patch = (who, payload) => call('PATCH', '/v1/me', who, payload);

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code);
}

test('GET /v1/me returns the three visibility groups', async () => {
  const res = await call('GET', '/v1/me', 'max');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    id: users.max.id,
    emailVerified: true,
    plan: 'free',
    providers: ['password'],
    public: { displayName: 'max', avatarUrl: null, bio: null, genres: [] },
    friends: { city: 'Paris', phone: '+33 6 00 00 00 00' },
    private: { realName: 'Maximilien B.', birthDate: '1999-04-12', email: email('max') },
  });
});

test('PATCH changes only the fields sent; null clears; genres replace the list', async () => {
  const res = await patch('max', {
    bio: 'Fan de jazz\net de rock',
    city: null,
    genreIds: [genres.Rock, genres.Jazz],
  });

  assert.equal(res.statusCode, 200);
  const me = res.json();
  assert.equal(me.public.bio, 'Fan de jazz\net de rock');
  assert.equal(me.public.displayName, 'max');
  assert.equal(me.friends.city, null);
  assert.equal(me.friends.phone, '+33 6 00 00 00 00');
  assert.equal(me.private.realName, 'Maximilien B.');
  assert.deepEqual(
    me.public.genres.map((g) => g.id),
    [genres.Jazz, genres.Rock],
  );

  const replaced = (await patch('max', { genreIds: [genres.Ambient] })).json();
  assert.deepEqual(
    replaced.public.genres.map((g) => g.id),
    [genres.Ambient],
  );
  assert.equal((await patch('max', { genreIds: [] })).json().public.genres.length, 0);
});

test('PATCH refuses bad values and read-only or unknown fields', async () => {
  const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
  const bad = [
    { displayName: null },
    { displayName: '' },
    { displayName: `Max${RLO}` },
    { city: `Paris${'\n'}Lyon` },
    { bio: `Hi${RLO}` },
    { bio: 'x'.repeat(501) },
    { phone: '<script>' },
    { birthDate: future },
    { birthDate: '1850-01-01' },
    { birthDate: '12/04/1999' },
    { genreIds: [genres.Jazz, genres.Jazz] },
    { genreIds: Array.from({ length: 21 }, (_, i) => i + 1) },
    { email: 'new@example.com' },
    { plan: 'premium' },
    { avatarUrl: 'http://evil.example.com/pixel.png' },
    { id: users.stranger.id },
  ];
  for (const payload of bad) {
    assertProblem(await patch('max', payload), 400, 'validation_failed');
  }
});

test('an unknown genre is a 400 and nothing is changed', async () => {
  await patch('max', { bio: 'before', genreIds: [genres.Jazz] });

  const res = await patch('max', { bio: 'after', genreIds: [genres.Rock, 999_999_999] });

  assertProblem(res, 400, 'unknown_genre');
  const me = (await call('GET', '/v1/me', 'max')).json();
  assert.equal(me.public.bio, 'before');
  assert.deepEqual(
    me.public.genres.map((g) => g.id),
    [genres.Jazz],
  );
});

test('PATCH only ever changes the caller', async () => {
  await patch('max', { displayName: 'Max' });

  const other = (await call('GET', `/v1/users/${users.stranger.id}`, 'stranger')).json();
  assert.equal(other.public.displayName, 'stranger');
});

test('a stranger sees only the public group, never friends or private', async () => {
  const res = await call('GET', `/v1/users/${users.max.id}`, 'stranger');

  assert.equal(res.statusCode, 200);
  const profile = res.json();
  assert.equal(profile.relationship, 'none');
  assert.equal(profile.friends, null);
  assert.equal(profile.private, undefined);
  assert.equal(profile.public.displayName, 'Max');
  // Nothing private anywhere in the answer
  for (const secret of [email('max'), 'Maximilien', '1999-04-12', '+33']) {
    assert.ok(!res.body.includes(secret), secret);
  }
});

test('an accepted friend also sees the friends group; a pending request does not count', async () => {
  const friend = (await call('GET', `/v1/users/${users.max.id}`, 'friend')).json();
  assert.equal(friend.relationship, 'friend');
  assert.deepEqual(friend.friends, { city: null, phone: '+33 6 00 00 00 00' });
  assert.equal(friend.private, undefined);

  const pending = (await call('GET', `/v1/users/${users.max.id}`, 'pending')).json();
  assert.equal(pending.relationship, 'none');
  assert.equal(pending.friends, null);
});

test('my own id gives relationship self', async () => {
  const self = (await call('GET', `/v1/users/${users.max.id}`, 'max')).json();

  assert.equal(self.relationship, 'self');
  assert.ok(self.friends);
});

test('unknown and malformed ids get the same 404', async () => {
  for (const id of [randomUUID(), 'not-a-uuid', '1 OR 1=1', 'x'.repeat(90)]) {
    assertProblem(
      await call('GET', `/v1/users/${encodeURIComponent(id)}`, 'max'),
      404,
      'user_not_found',
    );
  }
});

test('genres are listed by name', async () => {
  const res = await call('GET', '/v1/genres', 'max');

  assert.equal(res.statusCode, 200);
  const names = res.json().genres.map((g) => g.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'en')),
  );
  assert.ok(names.includes(`Jazz-${RUN}`));
});

test('PUT /v1/me/subscription switches the plan, idempotently', async () => {
  const subscribe = (payload) => call('PUT', '/v1/me/subscription', 'pending', payload);
  const plan = async () => (await call('GET', '/v1/me', 'pending')).json().plan;
  assert.equal(await plan(), 'free');

  for (const target of ['premium', 'premium', 'free', 'free']) {
    const res = await subscribe({ plan: target });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
    assert.equal(await plan(), target);
  }

  for (const payload of [{}, { plan: 'gold' }, { plan: 'premium', extra: 1 }]) {
    assertProblem(await subscribe(payload), 400, 'validation_failed');
  }
  assert.equal(await plan(), 'free');
});

test('every profile route needs an access token', async () => {
  for (const [method, url] of [
    ['GET', '/v1/me'],
    ['PATCH', '/v1/me'],
    ['GET', `/v1/users/${users.max.id}`],
    ['GET', '/v1/genres'],
    ['PUT', '/v1/me/subscription'],
  ]) {
    assertProblem(
      await call(method, url, null, method === 'GET' ? undefined : {}),
      401,
      'unauthorized',
    );
  }
});

test('the profile routes are documented', async () => {
  const spec = (await app.inject({ url: '/docs/json' })).json();

  assert.ok(spec.paths['/v1/me']?.get && spec.paths['/v1/me']?.patch);
  assert.ok(spec.paths['/v1/users/{id}']?.get);
  assert.ok(spec.paths['/v1/genres']?.get);
  assert.ok(spec.paths['/v1/me/subscription']?.put);
});

test('an empty phone clears it, like the other optional fields', async () => {
  await patch('max', { phone: '+33 1 23 45 67 89' });

  const res = await patch('max', { phone: '' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().friends.phone, null);
});

test('the reference genres come from the migration, without make seed', async () => {
  const res = await call('GET', '/v1/genres', 'max');

  const names = res.json().genres.map((g) => g.name);
  for (const name of ['Pop', 'Rock', 'Electronic', 'Hip-hop', 'Jazz']) {
    assert.ok(names.includes(name), `${name} is missing`);
  }
  for (const name of ['Classical', 'Reggae', 'Metal', 'Folk', 'Ambient']) {
    assert.ok(names.includes(name), `${name} is missing`);
  }
});