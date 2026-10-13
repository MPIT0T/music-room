import { HttpProblem } from '../errors.js';

const unauthorized = () =>
  new HttpProblem(401, 'unauthorized', { headers: { 'www-authenticate': 'Bearer' } });

export async function requireAuth(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw unauthorized();

  try {
    const token = header.slice('Bearer '.length);
    const { userId, deviceId } = await request.server.tokens.verifyAccessToken(token);
    request.userId = userId;
    request.deviceId = deviceId;
  } catch (err) {
    request.log.debug({ reason: err.message }, 'access token rejected');
    throw unauthorized();
  }
}
