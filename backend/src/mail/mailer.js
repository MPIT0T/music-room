import nodemailer from 'nodemailer';
import { alreadyRegistered, passwordReset, verifyEmail } from './templates.js';

export function createMailer(
  config,
  { transport = nodemailer.createTransport(config.smtp), log } = {},
) {
  const link = (path, token) => `${config.appBaseUrl}${path}?token=${encodeURIComponent(token)}`;

  async function send(template, to, message) {
    const info = await transport.sendMail({ from: config.from, to, ...message });
    // Never the recipient, the link or the body: the link carries a single-use token
    log?.info({ template, messageId: info.messageId }, 'email sent');
    return info;
  }

  return {
    sendVerifyEmail: (to, { displayName, token }) =>
      send('verifyEmail', to, verifyEmail({ displayName, link: link('/verify-email', token) })),
    sendAlreadyRegistered: (to) => send('alreadyRegistered', to, alreadyRegistered()),
    sendPasswordReset: (to, { token }) =>
      send('passwordReset', to, passwordReset({ link: link('/reset-password', token) })),
  };
}
