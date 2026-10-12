import { z } from 'zod';
import { safeText } from '../validation.js';

const isoDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString(),
});

const visibility = z.enum(['public', 'private']);
const accessPolicy = z.enum(['everyone', 'invited', 'time_window']);
const roomWindow = z.object({ start: isoDate, end: isoDate });

export function roomRuleIssues(room) {
  const issues = [];
  if (room.window != null && !(room.window.end > room.window.start)) {
    issues.push({ path: ['window', 'end'], message: 'must be after window.start' });
  }
  if (room.accessPolicy === 'time_window' && room.window == null) {
    issues.push({ path: ['window'], message: 'required when accessPolicy is time_window' });
  }
  return issues;
}

const addRuleIssues = (room, ctx) => {
  for (const issue of roomRuleIssues(room)) ctx.addIssue({ code: 'custom', ...issue });
};

export const createRoomBody = z
  .object({
    name: safeText({ min: 1, max: 100 }),
    description: safeText({ max: 1000 }).nullable().default(null),
    visibility: visibility.default('public'),
    accessPolicy: accessPolicy.default('everyone'),
    window: roomWindow.nullable().default(null),
  })
  .superRefine(addRuleIssues);

export const patchRoomBody = z
  .object({
    name: safeText({ min: 1, max: 100 }).optional(),
    description: safeText({ max: 1000 }).nullable().optional(),
    visibility: visibility.optional(),
    accessPolicy: accessPolicy.optional(),
    window: roomWindow.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' })
  .refine((body) => body.window == null || body.window.end > body.window.start, {
    message: 'must be after window.start',
    path: ['window', 'end'],
  });

export const ifMatchHeaders = z.looseObject({
  'if-match': z.string().max(64).optional().describe('ETag of the room, as returned by GET'),
});

export const roomParams = z.object({ id: z.string().max(64) });

export const roomResponse = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  visibility,
  accessPolicy,
  window: roomWindow.nullable(),
  beaconMinor: z.number().int().nullable(),
  version: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
