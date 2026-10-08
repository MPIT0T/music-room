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
