import { SignJWT, jwtVerify } from 'jose';

const ALGORITHM = 'HS256';
const ISSUER = 'music-room';
const AUDIENCE = 'music-room-api';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// HS256 is only as strong as its secret: a short one can be brute-forced offline from any token
const MIN_SECRET_LENGTH = 32;
// Bounds the work a client can make us do with an oversized token
const MAX_TOKEN_LENGTH = 4096;

export class InvalidTokenError extends Error {}

export function createTokenService(secret = process.env.JWT_SECRET) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (generate one with: openssl rand -hex 32)`,
    );
  }
  const key = new TextEncoder().encode(secret);

  return {
    signAccessToken({ userId, deviceId }) {
      return new SignJWT({ did: deviceId })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },

    async verifyAccessToken(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        throw new InvalidTokenError('malformed token');
      }
      let payload;
      try {
        ({ payload } = await jwtVerify(token, key, {
          // Pinning the algorithm rejects "alg: none" and algorithm-confusion tokens
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
          requiredClaims: ['sub', 'did', 'iat', 'exp'],
        }));
      } catch (err) {
        // jose codes (ERR_JWT_EXPIRED...) are kept for the logs, never sent to the client
        throw new InvalidTokenError(err.code ?? 'invalid token', { cause: err });
      }
      if (typeof payload.did !== 'string') throw new InvalidTokenError('invalid did claim');
      return { userId: payload.sub, deviceId: payload.did };
    },
  };
}
