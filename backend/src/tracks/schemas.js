import { z } from 'zod';
import { safeText } from '../validation.js';

export const trackResponse = z.object({
  id: z.uuid().describe('Our id: the only one clients ever see'),
  title: z.string(),
  artist: z.string(),
  durationMs: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
});

export const searchQuery = z.object({
  q: safeText({ min: 1, max: 100 }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchResponse = z.object({ tracks: z.array(trackResponse) });

export const trackParams = z.object({ id: z.string().max(64) });

export const streamResponse = z.object({
  url: z
    .url()
    .describe('Playable MP3 stream, valid for a short time: fetch it again for each play'),
});
