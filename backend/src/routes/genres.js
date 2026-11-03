import { z } from 'zod';
import { problemSchema } from '../errors.js';
import { requireAuth } from '../auth/guards.js';

export default async function genresRoutes(app) {
  app.get(
    '/v1/genres',
    {
      onRequest: requireAuth,
      schema: {
        tags: ['profile'],
        summary: 'Music genres, to choose music preferences',
        description: 'Sorted by name. Their ids go in genreIds of PATCH /v1/me.',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({ genres: z.array(z.object({ id: z.number().int(), name: z.string() })) }),
          401: problemSchema,
        },
      },
    },
    async () => {
      const [rows] = await app.db.query('SELECT id, name FROM genres ORDER BY name');
      return { genres: rows.map(({ id, name }) => ({ id: Number(id), name })) };
    },
  );
}
