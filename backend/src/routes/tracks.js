import { z } from 'zod';
import { HttpProblem } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { rateLimit } from '../security/rate-limit.js';
import { findTrack, publicTrack, upsertTracks } from '../tracks/repo.js';
import { searchQuery, searchResponse, streamResponse, trackParams } from '../tracks/schemas.js';

const trackId = z.uuid();

export default async function tracksRoutes(app) {
  app.addHook('onRequest', requireAuth);

  const searchSchema = {
    tags: ['tracks'],
    summary: 'Search the music catalog',
    description:
      'Searches Jamendo and saves the results, so they can be added to a room by our id. ' +
      'Rate limited per user. 502 when Jamendo is unreachable, 503 when not configured.',
    security: [{ bearerAuth: [] }],
    querystring: searchQuery,
    response: { 200: searchResponse },
  };

  const searchLimit = rateLimit(app.limits.trackSearch, (request) => request.userId);

  app.get('/v1/tracks', { schema: searchSchema, preHandler: searchLimit }, async (request) => {
    const { q, limit } = request.query;
    const found = await app.music.search(q, { limit });
    const tracks = await upsertTracks(app.db, found);
    return { tracks: tracks.map(publicTrack) };
  });

  const streamSchema = {
    tags: ['tracks'],
    summary: 'Get a playable URL for a track',
    description:
      'Called by the playing device when the track starts. The URL comes fresh from Jamendo ' +
      'and is never stored. 404 for an unknown id, 410 when Jamendo no longer serves the track.',
    security: [{ bearerAuth: [] }],
    params: trackParams,
    response: { 200: streamResponse },
  };

  app.get('/v1/tracks/:id/stream', { schema: streamSchema }, async (request, reply) => {
    const track = trackId.safeParse(request.params.id).success
      ? await findTrack(app.db, request.params.id)
      : null;
    if (track == null) throw new HttpProblem(404, 'track_not_found');

    const url = await app.music.getStreamUrl(track.providerTrackId);
    if (url == null) {
      throw new HttpProblem(410, 'track_unavailable', {
        detail: 'The provider no longer serves this track',
      });
    }

    return reply.header('cache-control', 'no-store').send({ url });
  });
}
