import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';
import { passwords as realPasswords } from '../src/auth/passwords.js';

// Integration tests: real MariaDB (make test). Every address is unique to this run.
const RUN = randomUUID().slice(0, 8);
const email = (name) => `signup-${RUN}-${name}@example.com`;
const PASSWORD = 'correct horse battery';

// Records emails instead of sending them; failNext simulates an SMTP outage
const mailer = {
  sent: [],
  pending: [],
  failNext: false,
  record(type, to, data) {
    const fail = this.failNext;
    this.failNext = false;
    const p = fail
      ? Promise.reject(Object.assign(new Error(`RCPT TO:<${to}> refused`), { code: 'EENVELOPE' }))
      : Promise.resolve().then(() => this.sent.push({ type, to, data }));
    this.pending.push(p.catch(() => {}));
    return p;
  },
  sendVerifyEmail(to, data) {
    return this.record('verify', to, data);
  },
  sendAlreadyRegistered(to) {
    return this.record('alreadyRegistered', to);
  },
  settle() {
    return Promise.all(this.pending);
  },
};

// Counts hash calls to prove the existing-email branch does the same work
const passwords = {
  hashCalls: 0,
  hash(plain) {
    this.hashCalls++;
    return realPasswords.hash(plain);
  },
  verify: realPasswords.verify,
};

const logChunks = [];
const stream = new Writable({
  write(chunk, _enc, done) {
    logChunks.push(chunk.toString());
    done();
  },
});

let app;
before(async () => {
  app = await buildApp({ mailer, passwords, logger: loggerOptions({ stream }) });
});
beforeEach(() => {
  mailer.sent.length = 0;
  passwords.hashCalls = 0;
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`signup-${RUN}-%`]);
  await app.close();
});

const signup = (body) => app.inject({ method: 'POST', url: '/v1/users', payload: body });
const verify = (token) =>
  app.inject({ method: 'POST', url: '/v1/users/verify-email', payload: { token } });
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

async function userRow(address) {
  const [[row]] = await app.db.query(
    'SELECT id, email, password_hash, email_verified_at FROM users WHERE email = ?',
    [address],
  );
  return row;
}

test('a new email creates an unverified account and sends a verification link', async () => {
  const address = email('new');

  const res = await signup({
    email: address.toUpperCase(),
    password: PASSWORD,
    displayName: 'Max',
  });
  await mailer.settle();

  assert.equal(res.statusCode, 202);
  assert.equal(res.body, '');
  const user = await userRow(address);
  assert.equal(user.email, address);
  assert.match(user.password_hash, /^\$argon2id\$/);
  assert.equal(user.email_verified_at, null);

  const [mail] = mailer.sent;
  assert.equal(mail.type, 'verify');
  const [[stored]] = await app.db.query('SELECT token_hash FROM email_tokens WHERE user_id = ?', [
    user.id,
  ]);
  assert.equal(stored.token_hash, sha256(mail.data.token));
  assert.notEqual(stored.token_hash, mail.data.token);
});

test('an existing email gets the exact same answer, after the same work', async () => {
  const address = email('taken');
  const first = await signup({ email: address, password: PASSWORD, displayName: 'Max' });
  await mailer.settle();
  mailer.sent.length = 0;
  passwords.hashCalls = 0;

  const second = await signup({ email: address, password: 'another password', displayName: 'Eve' });
  await mailer.settle();

  const comparable = (res) => {
    const headers = { ...res.headers };
    delete headers['x-request-id'];
    delete headers.date;
    return { status: res.statusCode, body: res.body, headers };
  };
  assert.deepEqual(comparable(second), comparable(first));
  assert.equal(passwords.hashCalls, 1);
  assert.deepEqual(
    mailer.sent.map((m) => m.type),
    ['alreadyRegistered'],
  );
  const [[{ n }]] = await app.db.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [
    address,
  ]);
  assert.equal(Number(n), 1);
});

test('invalid input is a 400 that never echoes the password', async () => {
  const res = await signup({ email: 'not-an-email', password: 'short', displayName: '' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'validation_failed');
  assert.deepEqual(
    res
      .json()
      .errors.map((e) => e.path)
      .sort(),
    ['displayName', 'email', 'password'],
  );
  assert.ok(!res.body.includes('short'));
});

test('an SMTP failure does not change the answer and is logged without the address', async () => {
  const address = email('smtp');
  mailer.failNext = true;

  const res = await signup({ email: address, password: PASSWORD, displayName: 'Max' });
  await mailer.settle();

  assert.equal(res.statusCode, 202);
  const failure = logChunks.find((l) => l.includes('signup email failed'));
  assert.ok(failure);
  assert.ok(!failure.includes(address));
});

test('a verification token works once and marks the email verified', async () => {
  const address = email('verify');
  await signup({ email: address, password: PASSWORD, displayName: 'Max' });
  await mailer.settle();
  const { token } = mailer.sent[0].data;

  const ok = await verify(token);
  const again = await verify(token);

  assert.equal(ok.statusCode, 204);
  assert.notEqual((await userRow(address)).email_verified_at, null);
  assert.equal(again.statusCode, 400);
  assert.equal(again.json().code, 'invalid_token');
});

test('expired and made-up tokens are refused', async () => {
  const address = email('expired');
  await signup({ email: address, password: PASSWORD, displayName: 'Max' });
  await mailer.settle();
  const { token } = mailer.sent[0].data;
  await app.db.query(
    'UPDATE email_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE token_hash = ?',
    [sha256(token)],
  );

  for (const candidate of [token, randomBytes(32).toString('base64url')]) {
    const res = await verify(candidate);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'invalid_token');
  }
  assert.equal((await userRow(address)).email_verified_at, null);
});

test('display names refuse control and text-direction characters', async () => {
  for (const displayName of ['\u202Eevil', 'a\u0000b', '\u001b[31mred', 'two\nlines']) {
    const res = await signup({ email: email('invisible'), password: PASSWORD, displayName });

    assert.equal(res.statusCode, 400, JSON.stringify(displayName));
    assert.deepEqual(
      res.json().errors.map((e) => e.path),
      ['displayName'],
    );
  }
});

test('display names keep emojis and are stored in NFC form', async () => {
  const address = email('unicode');

  // "Zoé" typed with a combining accent (e + U+0301), plus a family emoji built with joiners
  const res = await signup({
    email: address,
    password: PASSWORD,
    displayName: 'Zoe\u0301 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
  });

  assert.equal(res.statusCode, 202);
  const [[row]] = await app.db.query('SELECT display_name FROM users WHERE email = ?', [address]);
  assert.equal(row.display_name, 'Zo\u00E9 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}');
});

test('SQL typed in a field is stored as plain text', async () => {
  const address = email('sql');
  const displayName = "x'); DROP TABLE users; --";

  const res = await signup({ email: address, password: PASSWORD, displayName });

  assert.equal(res.statusCode, 202);
  const [[row]] = await app.db.query('SELECT display_name FROM users WHERE email = ?', [address]);
  assert.equal(row.display_name, displayName);
});

test('prototype pollution and malformed tokens are refused before the database', async () => {
  const polluted = await app.inject({
    method: 'POST',
    url: '/v1/users/verify-email',
    headers: { 'content-type': 'application/json' },
    payload: '{"__proto__":{"admin":true},"token":"x"}',
  });
  assert.equal(polluted.statusCode, 400);

  for (const token of ["' OR 1=1 -- ", 'a'.repeat(42), 'a'.repeat(43) + '!', { token_hash: 1 }]) {
    const res = await verify(token);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'validation_failed');
  }
});

test('both routes are documented in the OpenAPI spec', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  assert.deepEqual(Object.keys(spec.paths['/v1/users'].post.responses), ['202']);
  assert.deepEqual(Object.keys(spec.paths['/v1/users/verify-email'].post.responses), ['204']);
});

test('no password and no token ever reach the logs', async () => {
  const address = email('logs');
  await signup({ email: address, password: PASSWORD, displayName: 'Max' });
  await mailer.settle();
  await verify(mailer.sent[0].data.token);

  const output = logChunks.join('');
  assert.ok(!output.includes(PASSWORD));
  assert.ok(!output.includes(mailer.sent[0].data.token));
});
