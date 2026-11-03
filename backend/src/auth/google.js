import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cleanText } from '../validation.js';
import { HttpProblem } from '../errors.js';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Fetched on first use, then cached and refreshed by jose when Google rotates its keys
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const DISPLAY_NAME_MAX = 50;

// Verifies Google ID tokens. jwks is injectable: tests sign with their own RSA key, offline.
export function createGoogleVerifier({ audiences, jwks = createRemoteJWKSet(GOOGLE_JWKS_URL) }) {
  return {
    configured: audiences.length > 0,

    async verify(idToken) {
      // aud must be one of our client IDs: a token issued to another app must not open a session here
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: audiences,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp'],
      });
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
      return {
        sub: String(payload.sub),
        email: email && email.length <= 255 ? email : null,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: cleanText(payload.name, DISPLAY_NAME_MAX) || 'Google user',
        aud: payload.aud,
        azp: payload.azp,
      };
    },
  };
}

// Our JWKS fetch failed (network, Google down): not the client's fault, the token was not judged
export function isGoogleUnavailable(err) {
  return !err.code || err.code === 'ERR_JWKS_TIMEOUT' || err.code === 'ERR_JOSE_GENERIC';
}

// Shared by sign-in and account linking: one place for the checks, the error codes and the logs.
// Only the reason is ever logged: the ID token is a bearer credential for its lifetime.
export async function verifyGoogleIdToken(app, request, idToken) {
  if (!app.googleVerifier.configured) throw new HttpProblem(503, 'oauth_unavailable');
  try {
    return await app.googleVerifier.verify(idToken);
  } catch (err) {
    if (isGoogleUnavailable(err)) {
      request.log.warn({ reason: err.code ?? err.name }, 'google keys unavailable');
      throw new HttpProblem(503, 'oauth_unavailable');
    }
    request.log.info({ reason: err.code, claim: err.claim }, 'google id token rejected');
    throw new HttpProblem(401, 'invalid_oauth_token');
  }
}
