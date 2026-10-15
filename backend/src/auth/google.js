import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cleanText } from '../validation.js';

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
