import { HttpProblem } from '../errors.js';

// One token made of base64url parts; the scheme name is case-insensitive (RFC 6750)
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i;

const unauthorized = () =>
  new HttpProblem(401, 'unauthorized', { headers: { 'www-authenticate': 'Bearer' } });

export async function requireAuth(request, reply) {
  const match = BEARER.exec(request.headers.authorization ?? '');
  if (!match) throw unauthorized();

  try {
    const { userId, deviceId } = await request.server.tokens.verifyAccessToken(match[1]);
    request.userId = userId;
    request.deviceId = deviceId;
    // Every later log line of this request, "request completed" included, says who made it
    request.log = request.log.child({ userId, deviceId });
    reply.log = request.log;
  } catch (err) {
    request.log.debug({ reason: err.message }, 'access token rejected');
    throw unauthorized();
  }
}
