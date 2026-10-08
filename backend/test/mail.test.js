import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { readMailConfig } from '../src/config.js';
import { createMailer } from '../src/mail/mailer.js';

const TOKEN = 'tok+en/with=special&chars';
const config = readMailConfig({
  APP_BASE_URL: 'https://music.example.com/',
  MAIL_FROM: 'no-reply@music.example.com',
});

// jsonTransport builds the full message without any network access
function mailerWithCapture() {
  const logs = [];
  const log = { info: (obj, msg) => logs.push(JSON.stringify({ ...obj, msg })) };
  const mailer = createMailer(config, {
    transport: nodemailer.createTransport({ jsonTransport: true }),
    log,
  });
  const read = (info) => JSON.parse(info.message);
  return { mailer, logs, read };
}

test('verification and reset emails carry an encoded link built from APP_BASE_URL', async () => {
  const { mailer, read } = mailerWithCapture();

  const verify = read(
    await mailer.sendVerifyEmail('max@example.com', { displayName: 'Max', token: TOKEN }),
  );
  const reset = read(await mailer.sendPasswordReset('max@example.com', { token: TOKEN }));

  const encoded = encodeURIComponent(TOKEN);
  assert.ok(verify.text.includes(`https://music.example.com/verify-email?token=${encoded}`));
  assert.ok(reset.text.includes(`https://music.example.com/reset-password?token=${encoded}`));
  assert.equal(verify.from.address, 'no-reply@music.example.com');
  assert.equal(verify.to[0].address, 'max@example.com');
  for (const mail of [verify, reset]) assert.ok(!mail.subject.includes(TOKEN));
});

test('the already-registered email contains no link and no token', async () => {
  const { mailer, read } = mailerWithCapture();

  const mail = read(await mailer.sendAlreadyRegistered('max@example.com'));

  assert.ok(!mail.text.includes('http'));
  assert.ok(!mail.html.includes('<a '));
});

test('a display name cannot inject HTML into the email', async () => {
  const { mailer, read } = mailerWithCapture();

  const mail = read(
    await mailer.sendVerifyEmail('max@example.com', {
      displayName: '<img src=x onerror=alert(1)>',
      token: TOKEN,
    }),
  );

  assert.ok(!mail.html.includes('<img'));
  assert.ok(mail.html.includes('&lt;img'));
});

test('logs name the template but never the recipient or the token', async () => {
  const { mailer, logs } = mailerWithCapture();

  await mailer.sendPasswordReset('max@example.com', { token: TOKEN });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /"template":"passwordReset"/);
  assert.ok(!logs[0].includes('max@example.com'));
  assert.ok(!logs[0].includes(encodeURIComponent(TOKEN)));
  assert.ok(!logs[0].includes(TOKEN));
});

test('readMailConfig defaults to Mailpit, enforces TLS in production, rejects bad values', () => {
  const dev = readMailConfig({ SMTP_HOST: '', SMTP_PORT: '' });
  assert.deepEqual([dev.smtp.host, dev.smtp.port, dev.smtp.requireTLS], ['mailpit', 1025, false]);

  const prod = readMailConfig({
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
  });
  assert.equal(prod.smtp.requireTLS, true);
  assert.equal(readMailConfig({ SMTP_PORT: '465' }).smtp.secure, true);

  assert.throws(() => readMailConfig({ MAIL_FROM: 'not-an-email' }), /MAIL_FROM/);
  assert.throws(() => readMailConfig({ APP_BASE_URL: 'javascript:alert(1)' }), /APP_BASE_URL/);
});
