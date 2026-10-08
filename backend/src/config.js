import { z } from 'zod';

// OAuth client IDs are public (Google ships them inside the apps): .env is for convenience, not secrecy
const clientId = z
  .string()
  .regex(/^[\w-]+\.apps\.googleusercontent\.com$/, 'expected <id>.apps.googleusercontent.com');

// compose turns an unset variable into '' (${VAR:-}): treat it as missing
const optionalClientId = z.preprocess((v) => (v === '' ? undefined : v), clientId.optional());

const googleEnv = z.object({
  GOOGLE_CLIENT_ID_WEB: optionalClientId,
  GOOGLE_CLIENT_ID_ANDROID: optionalClientId,
});

export function readGoogleConfig(env = process.env) {
  const { GOOGLE_CLIENT_ID_WEB: web, GOOGLE_CLIENT_ID_ANDROID: android } = googleEnv.parse(env);
  return {
    webClientId: web,
    androidClientId: android,
    // Values accepted for the `aud` claim of a Google ID token: one client per platform
    audiences: [web, android].filter(Boolean),
  };
}

const blank = (v) => (v === '' ? undefined : v);

// Defaults match compose: Mailpit in dev, real SMTP values come from .env in prod
const mailEnv = z.object({
  SMTP_HOST: z.preprocess(blank, z.string().default('mailpit')),
  SMTP_PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).default(1025)),
  SMTP_USER: z.preprocess(blank, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(blank, z.string().optional()),
  MAIL_FROM: z.preprocess(blank, z.email().default('no-reply@musicroom.local')),
  APP_BASE_URL: z.preprocess(
    blank,
    z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  ),
  NODE_ENV: z.string().optional(),
});

export function readMailConfig(env = process.env) {
  const e = mailEnv.parse(env);
  return {
    from: e.MAIL_FROM,
    // Links in emails are built from this value only, never from the request Host header
    appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ''),
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      // 465 is TLS from the start; elsewhere production must upgrade with STARTTLS or refuse to send
      secure: e.SMTP_PORT === 465,
      requireTLS: e.NODE_ENV === 'production' && e.SMTP_PORT !== 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    },
  };
}
