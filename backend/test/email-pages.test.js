import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loggerOptions } from '../src/logger.js';

const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };
const TOKEN = 'A'.repeat(43);

async function appWithLogs(t) {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: loggerOptions({ stream }) });
  t.after(() => app.close());
  return { app, logs: () => chunks.join('') };
}

for (const path of ['/verify-email', '/reset-password']) {
  test(`${path} is an HTML page locked down by security headers`, async (t) => {
    const { app } = await appWithLogs(t);

    const res = await app.inject({ url: `${path}?token=${TOKEN}` });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cache-control'], 'no-store');
    // The CSP forbids inline code: the page must not depend on any
    assert.doesNotMatch(res.body, /<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(res.body, /\son[a-z]+=/i);
    assert.doesNotMatch(res.body, /style=/);
  });
}

test('the page script and style are served with their types', async (t) => {
  const { app } = await appWithLogs(t);

  const script = await app.inject({ url: '/pages/email-pages.js' });
  const style = await app.inject({ url: '/pages/email-pages.css' });

  assert.equal(script.statusCode, 200);
  assert.match(script.headers['content-type'], /^text\/javascript/);
  assert.doesNotMatch(script.body, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.equal(style.statusCode, 200);
  assert.match(style.headers['content-type'], /^text\/css/);
});

test('the token in the link never reaches the logs', async (t) => {
  const { app, logs } = await appWithLogs(t);

  await app.inject({ url: `/verify-email?token=${TOKEN}` });
  await app.inject({ url: `/reset-password?token=${TOKEN}` });

  assert.ok(logs().includes('/verify-email'), 'the route is logged');
  assert.ok(!logs().includes(TOKEN), 'the token reached the logs');
});

test('the pages stay out of the API documentation', async (t) => {
  const { app } = await appWithLogs(t);

  const spec = (await app.inject({ url: '/docs/json' })).json();

  for (const path of ['/verify-email', '/reset-password', '/pages/email-pages.js']) {
    assert.equal(spec.paths[path], undefined, path);
  }
});
