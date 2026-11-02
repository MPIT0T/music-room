import { z } from 'zod';
import { HttpProblem } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { withTransaction } from '../db/tx.js';
import { rateLimit } from '../security/rate-limit.js';
import { emitFriendsChanged } from '../friends/events.js';
import {
  listFriends,
  listRequests,
  removeFriendship,
  requestOrAccept,
  searchUsers,
} from '../friends/repo.js';
import {
  friendParams,
  friendshipStatus,
  friendsResponse,
  requestsResponse,
  searchResponse,
} from '../friends/schemas.js';
import { searchQuery } from '../tracks/schemas.js';

export default async function friendsRoutes(app) {
  app.addHook('onRequest', requireAuth);

  const requestLimit = rateLimit(app.limits.friendRequest, (request) => request.userId);

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

  const listSchema = {
    tags: ['friends'],
    summary: 'List my friends',
    description: 'Accepted friendships only, sorted by display name.',
    security: [{ bearerAuth: [] }],
    response: { 200: friendsResponse },
  };
  app.get('/v1/friends', { schema: listSchema }, async (request) => ({
    friends: await listFriends(app.db, request.userId),
  }));

  const requestSchema = {
    tags: ['friends'],
    summary: 'List my pending friend requests',
    description: 'Newest first, split between requests I received and requests I sent.',
    security: [{ bearerAuth: [] }],
    response: { 200: requestsResponse },
  };
  app.get('/v1/friends/requests', { schema: requestSchema }, async (request) =>
    listRequests(app.db, request.userId),
  );

  const searchLimit = rateLimit(app.limits.userSearch, (request) => request.userId);
  const searchSchema = {
    tags: ['friends'],
    summary: 'Find users by display name',
    description:
      'Prefix match, case insensitive, verified accounts only, never me. Never searches ' +
      'emails, so it cannot tell who has an account. Rate limited per user.',
    security: [{ bearerAuth: [] }],
    querystring: searchQuery,
    response: { 200: searchResponse },
  };
  app.get(
    '/v1/users/search',
    { schema: searchSchema, preHandler: searchLimit },
    async (request) => {
      const { q, limit } = request.query;
      return { users: await searchUsers(app.db, request.userId, q, limit) };
    },
  );
}
