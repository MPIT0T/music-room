import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';

// Integration tests: real MariaDB and Redis (make test)
const RUN = randomUUID().slice(0, 8);
const email = (name) => `resend-${RUN}-${name}@example.com`;
const PASSWORD = 'correct horse battery';

const mailer = {
  sent: [],
  async sendVerifyEmail(to, data) {
    this.sent.push({ type: 'verify', to, token: data.token });
  },
  async sendAlreadyRegistered(to) {
    this.sent.push({ type: 'alreadyRegistered', to });
  },
};

// Unique rule names per run; the signup limit is lowered to 3 to test it
const limits = {
  signup: { name: `signup-${RUN}`, limit: 3, windowSeconds: 60 },
  resendVerification: { name: `resend-${RUN}`, limit: 1, windowSeconds: 60 },
};

let app;
before(async () => {
  app = await buildApp({ mailer, limits, logger: false });
});
beforeEach(() => {
  mailer.sent.length = 0;
});
after(async () => {
  await app.db.query('DELETE FROM users WHERE email LIKE ?', [`resend-${RUN}-%`]);
  const keys = await app.redis.keys(`rl:*-${RUN}:*`);
  if (keys.length) await app.redis.del(keys);
  await app.close();
});

const post = (url, payload, ip = '127.0.0.1') =>
  app.inject({ method: 'POST', url, payload, remoteAddress: ip });
const signup = (address, ip) =>
  post('/v1/users', { email: address, password: PASSWORD, displayName: 'Max' }, ip);
const resend = (address) => post('/v1/users/verify-email/resend', { email: address });
const verify = (token) => post('/v1/users/verify-email', { token });

function assertRateLimited(res) {
  assert.equal(res.statusCode, 429);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, 'rate_limited');
  const retryAfter = Number(res.headers['retry-after']);
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `retry-after ${retryAfter}`);
}

test('resend issues a new link and revokes the previous one', async () => {
  const address = email('unverified');
  await signup(address, '10.0.0.1');
  const first = mailer.sent[0].token;
  mailer.sent.length = 0;

  const res = await resend(address);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body, '');
  const second = mailer.sent[0].token;
  assert.notEqual(second, first);
  assert.equal((await verify(first)).statusCode, 400);
  assert.equal((await verify(second)).statusCode, 204);
});

test('a second resend within the minute is a 429 with Retry-After', async () => {
  const address = email('twice');
  await signup(address, '10.0.0.2');

  assert.equal((await resend(address)).statusCode, 202);
  assertRateLimited(await resend(address));
});

test('an unknown email is answered and throttled exactly like a real one', async () => {
  const address = email('nobody');

  assert.equal((await resend(address)).statusCode, 202);
  assertRateLimited(await resend(address));
  assert.deepEqual(mailer.sent, []);
});

test('a verified account gets a 202 and no email', async () => {
  const address = email('verified');
  await signup(address, '10.0.0.3');
  await verify(mailer.sent[0].token);
  mailer.sent.length = 0;

  assert.equal((await resend(address)).statusCode, 202);
  assert.deepEqual(mailer.sent, []);
});

test('sign-ups from one IP are limited, other IPs are not', async () => {
  const ip = '10.0.0.99';
  for (let i = 0; i < 3; i++) assert.equal((await signup(email(`ip${i}`), ip)).statusCode, 202);

  assertRateLimited(await signup(email('ip3'), ip));
  assert.equal((await signup(email('other-ip'), '10.0.0.100')).statusCode, 202);
});

test('resend and the 429 answers are documented', async () => {
  const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

  assert.deepEqual(Object.keys(spec.paths['/v1/users/verify-email/resend'].post.responses), [
    '202',
    '429',
  ]);
  assert.deepEqual(Object.keys(spec.paths['/v1/users'].post.responses), ['202', '429']);
});
