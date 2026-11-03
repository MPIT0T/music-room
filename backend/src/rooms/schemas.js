import { z } from 'zod';
import { trackResponse } from '../tracks/schemas.js';
import { safeText } from '../validation.js';

const isoDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString(),
});

const visibility = z.enum(['public', 'private']);
const accessPolicy = z.enum(['everyone', 'invited', 'place_time']);
const roomWindow = z.object({ start: isoDate, end: isoDate });
// iBeacon minor: 16 bits, one per room (the UUID and major are fixed for the whole app)
const beaconMinor = z.number().int().min(0).max(65_535);

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const roomPlace = z.object({
  lat: latitude,
  lng: longitude,
  // Leave a margin: a phone indoors is often off by tens of meters
  radiusM: z.number().int().min(10).max(50_000).describe('Who is farther away cannot vote'),
});

export function roomRuleIssues(room) {
  const issues = [];
  if (room.window != null && !(room.window.end > room.window.start)) {
    issues.push({ path: ['window', 'end'], message: 'must be after window.start' });
  }
  if (room.accessPolicy === 'place_time' && room.window == null) {
    issues.push({ path: ['window'], message: 'required when accessPolicy is place_time' });
  }
  if (room.accessPolicy === 'place_time' && room.place == null) {
    issues.push({ path: ['place'], message: 'required when accessPolicy is place_time' });
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
    place: roomPlace.nullable().default(null),
    beaconMinor: beaconMinor
      .nullable()
      .default(null)
      .describe('Minor broadcast by the beacon at the event; unique across rooms'),
  })
  .superRefine(addRuleIssues);

export const patchRoomBody = z
  .object({
    name: safeText({ min: 1, max: 100 }).optional(),
    description: safeText({ max: 1000 }).nullable().optional(),
    visibility: visibility.optional(),
    accessPolicy: accessPolicy.optional(),
    window: roomWindow.nullable().optional(),
    place: roomPlace.nullable().optional(),
    beaconMinor: beaconMinor.nullable().optional(),
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
  place: roomPlace.nullable(),
  beaconMinor: z.number().int().nullable(),
  version: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const listRoomsQuery = z.object({
  beacon: z.coerce
    .number()
    .pipe(beaconMinor)
    .optional()
    .describe('Minor of a beacon the phone picked up: returns that public room only'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const roomsResponse = z.object({ rooms: z.array(roomResponse) });

export const memberParams = z.object({
  id: z.string().max(64),
  userId: z.uuid(),
});

export const membersResponse = z.object({
  members: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      joinedAt: isoDate,
    }),
  ),
});

export const queueItem = z.object({
  id: z.uuid().describe('Queue item id (not the track id): used to vote'),
  track: trackResponse,
  addedBy: z.uuid().nullable().describe('null if that user deleted their account'),
  votes: z.number().int(),
  myVote: z.boolean(),
  createdAt: isoDate,
});

export const queueResponse = z.object({
  playing: queueItem.nullable(),
  queue: z.array(queueItem),
});

export const addTrackBody = z.object({
  trackId: z.uuid().describe('Our track id, from GET /v1/tracks'),
});

export const itemParams = z.object({
  id: z.string().max(64),
  itemId: z.uuid(),
});

export const playbackBody = z.object({
  playing: z.boolean(),
  positionMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .describe('Position in the playing track when the owner phone sent it'),
});

export const playbackState = z.object({
  roomTrackId: z.uuid().describe('The playing queue item'),
  trackId: z.uuid(),
  playing: z.boolean(),
  positionMs: z.number().int(),
  at: isoDate.describe('Server time of the update: add (now - at) to positionMs while playing'),
});

export const playbackResponse = z.object({
  playback: playbackState.nullable().describe('null when nothing plays'),
});

// "lat,lng" as decimal degrees, e.g. "45.750000,4.850000"
const location = z
  .string()
  .max(64)
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'expected "lat,lng" in decimal degrees')
  .transform((text) => {
    const [lat, lng] = text.split(',').map(Number);
    return { lat, lng };
  })
  .pipe(z.object({ lat: latitude, lng: longitude }));

export const locationHeaders = z.looseObject({
  'x-location': location
    .optional()
    .describe('Position of the phone, "lat,lng": required in a place_time room'),
});
