import { z } from 'zod';

export const friendParams = z.object({
  userId: z.uuid(),
});

export const friendshipStatus = z.object({
  status: z.enum(['pending', 'accepted']),
});
