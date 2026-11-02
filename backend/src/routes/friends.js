import { z } from 'zod';
import { HttpProblem } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { withTransaction } from '../db/tx.js';
import { rateLimit } from '../security/rate-limit.js';
import { emitFriendsChanged } from '../friends/events.js';
import { removeFriendship, requestOrAccept } from '../friends/repo.js';
import { friendParams, friendshipStatus } from '../friends/schemas.js';

export default async function friendsRoutes(app) {
  app.addHook('onRequest', requireAuth);

  const putSchema = {
    tags: ['friends'],
    summary: 'Send a friend request, or accept the one this user sent me',
    description:
      'Idempotent. No request yet: creates one (pending). A request from this user: accepts it ' +
      '(accepted). Two users asking each other at the same time become friends. Only the ' +
      'receiver can accept. 400 cannot_friend_self, 404 user_not_found. Both users receive ' +
      '`friends.changed`.',
    security: [{ bearerAuth: [] }],
    params: friendParams,
    response: { 200: friendshipStatus },
  };
  const requestLimit = rateLimit(app.limits.friendRequest, (request) => request.userId);
  app.put(
    '/v1/friends/:userId',
    { schema: putSchema, preHandler: requestLimit },
    async (request) => {
      const { userId: otherId } = request.params;
      if (otherId === request.userId) throw new HttpProblem(400, 'cannot_friend_self');
      const status = await withTransaction(app.db, (conn) =>
        requestOrAccept(conn, request.userId, otherId),
      );
      emitFriendsChanged(app.io, request.userId, otherId, status);
      return { status };
    },
  );

  const deleteSchema = {
    tags: ['friends'],
    summary: 'Refuse or cancel a friend request, or remove a friend',
    description:
      'Idempotent: 204 even when there was nothing to remove. Removing a friend also removes ' +
      'every control delegation between the two accounts, in both directions. Both users ' +
      'receive `friends.changed` with `status: "none"`.',
    security: [{ bearerAuth: [] }],
    params: friendParams,
    response: { 204: z.null().describe('No friendship or request between the two users') },
  };
  app.delete('/v1/friends/:userId', { schema: deleteSchema }, async (request, reply) => {
    const { userId: otherId } = request.params;
    const removed = await withTransaction(app.db, (conn) =>
      removeFriendship(conn, request.userId, otherId),
    );
    if (removed) {
      emitFriendsChanged(app.io, request.userId, otherId, 'none');
    }
    return reply.code(204).send();
  });
}
