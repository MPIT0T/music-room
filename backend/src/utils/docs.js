import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

// Socket.IO is not described by OpenAPI: its contract lives here, shown at the top of /docs
const REALTIME_DOC = `
Errors are \`application/problem+json\` (RFC 9457): clients branch on \`code\`.

## Real time (Socket.IO)

Every write goes through this REST API; the socket only pushes what changed.

- **Connect** with the access token: \`io(url, { auth: { token } })\`. An invalid token is

  refused with the error \`unauthorized\`. An account holds 5 sockets at most and opens 30

  per minute: past that, the errors are \`too_many_connections\` and \`rate_limited\`. Do not

  retry at once. A message over 16 KB closes the socket.


- **subscribe** \`{ roomId }\` with an ack: \`{ ok: true, version }\`, or

  \`{ ok: false, code: 'NOT_FOUND' }\` for a room the user cannot see, or

  \`{ ok: false, code: 'RATE_LIMITED' }\` past 60 per minute.

  **unsubscribe** \`{ roomId }\` leaves it.


- **room.changed** \`{ roomId, version, change }\`, sent after the write is saved. \`change\`:

  \`queue\` (GET /v1/rooms/{id}/tracks again), \`members\` (GET .../members again),
  \`settings\` (GET /v1/rooms/{id} again),

  \`deleted\` (the room is gone, the subscription is closed).


- **room.playback** \`{ roomId, playback }\`: same body as GET /v1/rooms/{id}/playback.

  While \`playing\`, the position now is \`positionMs + (now - at)\`.
`;

export async function registerSwagger(app) {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Music Room API',
        version: '1.0',
        description: REALTIME_DOC,
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
}
