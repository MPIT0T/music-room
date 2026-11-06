import { z } from 'zod';
import { safeText } from '../validation.js';

const isoDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString(),
});

export const deviceParams = z.object({ id: z.uuid() });
export const delegationParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const renameBody = z.object({ name: safeText({ min: 1, max: 100 }) });

export const deviceResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: z.enum(['android', 'ios', 'web']),
  model: z.string().nullable(),
  appVersion: z.string().nullable(),
  signedIn: z.boolean().describe('false after a logout: the device stays listed'),
  online: z.boolean().describe('At least one socket of this device is connected'),
  current: z.boolean().describe('The device that sent this request'),
  lastSeenAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const devicesResponse = z.object({ devices: z.array(deviceResponse) });

const userSummary = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

export const grantBody = z
  .object({
    expiresAt: isoDate.nullish().describe('null or absent: until the owner removes it'),
  })
  .nullish();

export const deviceDelegation = userSummary.extend({
  expiresAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const deviceDelegationsResponse = z.object({ delegations: z.array(deviceDelegation) });

export const myDelegationsResponse = z.object({
  delegations: z.array(
    z.object({
      deviceId: z.uuid(),
      deviceName: z.string(),
      online: z.boolean(),
      owner: userSummary,
      expiresAt: isoDate.nullable(),
    }),
  ),
});
