import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { HttpProblem, problemSchema } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { loadMe, loadProfile } from '../users/profile.js';
import { safeText } from '../validation.js';

const genre = z.object({ id: z.number().int(), name: z.string() });

const publicGroup = z.object({
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  genres: z.array(genre),
});
const friendsGroup = z.object({ city: z.string().nullable(), phone: z.string().nullable() });

// Response schemas also filter: a column not listed here can never be sent
export const meSchema = z.object({
  id: z.string(),
  emailVerified: z.boolean(),
  plan: z.enum(['free', 'premium']),
  providers: z.array(z.string()),
  public: publicGroup,
  friends: friendsGroup,
  private: z.object({
    realName: z.string().nullable(),
    birthDate: z.string().nullable(),
    email: z.string().nullable(),
  }),
});

const profileSchema = z.object({
  id: z.string(),
  relationship: z.enum(['self', 'friend', 'none']),
  public: publicGroup,
  friends: friendsGroup.nullable().describe('null unless self or accepted friend'),
});

// '' is stored as "no value", like null
const optionalText = (schema) =>
  schema
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

const today = () => new Date().toISOString().slice(0, 10);

// Strict: an unknown or read-only field (email, plan, avatarUrl, id) is a 400, never ignored
const patchBody = z.strictObject({
  displayName: safeText({ min: 1, max: 50 }).optional(),
  bio: optionalText(safeText({ max: 500, multiline: true })),
  city: optionalText(safeText({ max: 100 })),
  realName: optionalText(safeText({ max: 100 })),
  phone: optionalText(
    z
      .string()
      .trim()
      // '' is accepted here so that it can clear the field, like the other optional texts
      .regex(/^([0-9 +().-]{3,30})?$/, 'digits, spaces and + ( ) . - only'),
  ),
  birthDate: z.iso
    .date()
    .refine((date) => date >= '1900-01-01' && date < today(), 'must be a past date after 1900')
    .nullable()
    .optional(),
  genreIds: z
    .array(z.number().int().positive())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'no duplicates')
    .optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function meRoutes(app) {
  app.addHook('onRequest', requireAuth);

  async function me(userId) {
    const result = await loadMe(app.db, userId);
    // Valid access token for an account deleted meanwhile
    if (!result) throw new HttpProblem(401, 'unauthorized');
    return result;
  }

  app.get(
    '/v1/me',
    {
      schema: {
        tags: ['profile'],
        summary: 'My full profile',
        description: 'Three visibility groups (ACC-8): public, friends, private.',
        security: [{ bearerAuth: [] }],
        response: { 200: meSchema, 401: problemSchema },
      },
    },
    async (request) => me(request.userId),
  );

  app.patch(
    '/v1/me',
    {
      schema: {
        tags: ['profile'],
        summary: 'Update my profile',
        description:
          'Only the fields sent are changed; null clears an optional field. genreIds replaces ' +
          'the whole list. All or nothing: an unknown genre leaves the profile untouched.',
        security: [{ bearerAuth: [] }],
        body: patchBody,
        response: { 200: meSchema, 400: problemSchema, 401: problemSchema },
      },
    },
    async (request) => {
      const body = request.body;
      const sent = (field) => body[field] !== undefined;

      await withTransaction(app.db, async (conn) => {
        // One fixed statement: each column is kept unless its flag says it was sent.
        // The SQL never depends on the request, and only these columns can ever change.
        await conn.query(
          `UPDATE users SET
             display_name = IF(?, ?, display_name),
             bio = IF(?, ?, bio),
             city = IF(?, ?, city),
             real_name = IF(?, ?, real_name),
             phone = IF(?, ?, phone),
             birth_date = IF(?, ?, birth_date)
           WHERE id = ?`,
          [
            ...['displayName', 'bio', 'city', 'realName', 'phone', 'birthDate'].flatMap((field) => [
              sent(field),
              body[field] ?? null,
            ]),
            request.userId,
          ],
        );

        if (body.genreIds) {
          const ids = body.genreIds;
          if (ids.length > 0) {
            const [[{ found }]] = await conn.query(
              'SELECT COUNT(*) AS found FROM genres WHERE id IN (?)',
              [ids],
            );
            // Thrown inside the transaction: the profile fields above are rolled back too
            if (Number(found) !== ids.length) throw new HttpProblem(400, 'unknown_genre');
          }
          await conn.query('DELETE FROM user_genres WHERE user_id = ?', [request.userId]);
          if (ids.length > 0) {
            await conn.query('INSERT INTO user_genres (user_id, genre_id) VALUES ?', [
              ids.map((id) => [request.userId, id]),
            ]);
          }
        }
      });
      return me(request.userId);
    },
  );

  app.get(
    '/v1/users/:id',
    {
      schema: {
        tags: ['profile'],
        summary: "Another user's profile, filtered by visibility",
        description:
          'public always; friends only for yourself or an accepted friend (null otherwise); ' +
          'private never. Unknown and malformed ids get the same 404.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: profileSchema, 401: problemSchema, 404: problemSchema },
      },
    },
    async (request) => {
      const id = request.params.id.toLowerCase();
      // Malformed, too long or unknown: the same 404 (contract)
      const profile = UUID.test(id) ? await loadProfile(app.db, request.userId, id) : null;
      if (!profile) throw new HttpProblem(404, 'user_not_found');
      return profile;
    },
  );
}
