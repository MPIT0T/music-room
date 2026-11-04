import { z } from 'zod';
import { HttpProblem, problems } from '../errors.js';
import { requireAuth } from '../auth/guards.js';
import { withTransaction } from '../db/tx.js';
import { canDelegateTo, canManageDelegations, canRevoke } from '../delegation/access.js';
import { emitDelegationsChanged } from '../delegation/events.js';
import { isDeviceOnline } from '../devices/presence.js';
import {
  deleteDelegation,
  findDevice,
  listDelegatedToMe,
  listDeviceDelegations,
  listDevices,
  renameDevice,
  upsertDelegation,
} from '../devices/repo.js';
import {
  delegationParams,
  deviceDelegation,
  deviceDelegationsResponse,
  deviceParams,
  deviceResponse,
  devicesResponse,
  grantBody,
  myDelegationsResponse,
  renameBody,
} from '../devices/schemas.js';
import { areFriends } from '../friends/repo.js';
import { findUserById } from '../users/repo.js';

export default async function devicesRoutes(app) {
  app.addHook('onRequest', requireAuth);

  // ownerId stays internal: it is always the caller here
  async function present(device, request) {
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      model: device.model,
      appVersion: device.appVersion,
      signedIn: device.signedIn,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
      online: await isDeviceOnline(app.io, device.id),
      current: device.id === request.deviceId,
    };
  }

  // Someone else's device answers 404, like an unknown one: ids reveal nothing
  async function ownDeviceOr404(request) {
    const device = await findDevice(app.db, request.params.id);
    if (device == null || !canManageDelegations(device, request.userId)) {
      throw new HttpProblem(404, 'not_found');
    }
    return device;
  }

  const listSchema = {
    tags: ['devices'],
    summary: 'List my devices',
    description:
      'Every device that ever logged in to my account, most recently seen first. Logged-out ' +
      'devices stay listed (`signedIn: false`) with their delegations.',
    security: [{ bearerAuth: [] }],
    response: { 200: devicesResponse, ...problems(401) },
  };
  app.get('/v1/devices', { schema: listSchema }, async (request) => {
    const devices = await listDevices(app.db, request.userId);
    return { devices: await Promise.all(devices.map((device) => present(device, request))) };
  });

  const renameSchema = {
    tags: ['devices'],
    summary: 'Rename one of my devices',
    description: 'The name my friends see ("Living room PC"). 404 for a device that is not mine.',
    security: [{ bearerAuth: [] }],
    params: deviceParams,
    body: renameBody,
    response: { 200: deviceResponse, ...problems(400, 401, 404) },
  };
  app.patch('/v1/devices/:id', { schema: renameSchema }, async (request) => {
    if (!(await renameDevice(app.db, request.params.id, request.userId, request.body.name))) {
      throw new HttpProblem(404, 'not_found');
    }
    return present(await findDevice(app.db, request.params.id), request);
  });

  const listDelegationsSchema = {
    tags: ['delegations'],
    summary: 'List the friends who may control one of my devices',
    description: 'Owner only (404 otherwise). Expired delegations are listed with their date.',
    security: [{ bearerAuth: [] }],
    params: deviceParams,
    response: { 200: deviceDelegationsResponse, ...problems(401, 404) },
  };
  app.get('/v1/devices/:id/delegations', { schema: listDelegationsSchema }, async (request) => {
    const device = await ownDeviceOr404(request);
    return { delegations: await listDeviceDelegations(app.db, device.id) };
  });

  const grantSchema = {
    tags: ['delegations'],
    summary: 'Let a friend control one of my devices',
    description:
      'Owner only. Idempotent: granting again replaces `expiresAt`. The friend then controls ' +
      'play, pause, seek and skip of my rooms while this device plays them. 400 ' +
      'cannot_delegate_self, 403 not_friend (accepted friends only), 404 for a device that ' +
      'is not mine. Both users receive `delegations.changed` with `status: "granted"`.',
    security: [{ bearerAuth: [] }],
    params: delegationParams,
    body: grantBody,
    response: { 200: deviceDelegation, ...problems(400, 401, 403, 404) },
  };
  app.put('/v1/devices/:id/delegations/:userId', { schema: grantSchema }, async (request) => {
    const device = await ownDeviceOr404(request);
    const delegateId = request.params.userId;
    const expiresAt = request.body?.expiresAt ?? null;
    if (expiresAt != null && expiresAt.getTime() <= Date.now()) {
      throw new HttpProblem(400, 'expires_in_past');
    }

    const delegation = await withTransaction(app.db, async (conn) => {
      // Locked: an unfriend running at the same time waits for this COMMIT, then removes
      // the delegation written here (friends/repo.js removeFriendship)
      const isFriend = await areFriends(conn, device.ownerId, delegateId, { lock: true });
      const verdict = canDelegateTo(device, request.userId, delegateId, isFriend);
      if (!verdict.allowed) {
        const status = verdict.reason === 'cannot_delegate_self' ? 400 : 403;
        throw new HttpProblem(status, verdict.reason);
      }
      return upsertDelegation(conn, device.id, delegateId, expiresAt);
    });

    emitDelegationsChanged(app.io, {
      ownerId: device.ownerId,
      delegateId,
      deviceId: device.id,
      status: 'granted',
    });
    request.log.info({ targetDeviceId: device.id, delegateId, expiresAt }, 'delegation granted');
    const user = await findUserById(app.db, delegateId);
    return {
      userId: delegateId,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      expiresAt: delegation.expiresAt,
      createdAt: delegation.createdAt,
    };
  });

  const revokeSchema = {
    tags: ['delegations'],
    summary: 'Remove a delegation',
    description:
      'The owner takes the control back, or the friend gives it up. Idempotent: 204 even when ' +
      'there was nothing to remove. 404 for anyone else. Both users receive ' +
      '`delegations.changed` with `status: "revoked"`; the friend loses control at once.',
    security: [{ bearerAuth: [] }],
    params: delegationParams,
    response: { 204: z.null(), ...problems(401, 404) },
  };
  app.delete(
    '/v1/devices/:id/delegations/:userId',
    { schema: revokeSchema },
    async (request, reply) => {
      const { id, userId: delegateId } = request.params;
      const device = await findDevice(app.db, id);
      if (device == null || !canRevoke(device, request.userId, delegateId)) {
        throw new HttpProblem(404, 'not_found');
      }
      if (await deleteDelegation(app.db, device.id, delegateId)) {
        emitDelegationsChanged(app.io, {
          ownerId: device.ownerId,
          delegateId,
          deviceId: device.id,
          status: 'revoked',
        });
        request.log.info({ targetDeviceId: device.id, delegateId }, 'delegation revoked');
      }
      return reply.code(204).send();
    },
  );

  const mineSchema = {
    tags: ['delegations'],
    summary: 'List the devices my friends let me control',
    description:
      'Live delegations only (expired ones are left out). `online`: the device can play now.',
    security: [{ bearerAuth: [] }],
    response: { 200: myDelegationsResponse, ...problems(401) },
  };
  app.get('/v1/delegations', { schema: mineSchema }, async (request) => {
    const delegations = await listDelegatedToMe(app.db, request.userId);
    return {
      delegations: await Promise.all(
        delegations.map(async (item) => ({
          ...item,
          online: await isDeviceOnline(app.io, item.deviceId),
        })),
      ),
    };
  });
}
