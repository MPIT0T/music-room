import { z } from 'zod';
import { safeText } from '../validation.js';

// copy paste from rooms/schemas.js
const isoDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString(),
});

export const friendParams = z.object({ userId: z.uuid() });

export const friendshipStatus = z.object({ status: z.enum(['pending', 'accepted']) });

const userSummary = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const friendRequest = userSummary.extend({ createdAt: isoDate });

export const friendsResponse = z.object({ friends: z.array(userSummary) });

export const requestsResponse = z.object({
  incoming: z.array(friendRequest).describe('Sent to me: PUT accepts, DELETE refuses'),
  outgoing: z.array(friendRequest).describe('Sent by me: DELETE cancels'),
});

export const searchQuery = z.object({
  q: safeText({ min: 1, max: 50 }),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

export const searchResponse = z.object({
  users: z.array(
    userSummary.extend({
      friendship: z
        .enum(['none', 'outgoing', 'incoming', 'accepted'])
        .describe('outgoing = I sent a request, incoming = they sent me one'),
    }),
  ),
});
