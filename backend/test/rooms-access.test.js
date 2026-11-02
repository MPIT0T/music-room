import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DENY,
  canManage,
  canRemoveMember,
  canView,
  canVote,
  distanceM,
  isWithinPlace,
  isWithinWindow,
  roleOf,
} from '../src/rooms/access.js';

const OWNER = 'owner-id';
const at = (iso) => new Date(iso);

// 16:00 to 18:00 UTC
const window = { start: at('2026-10-08T16:00:00Z'), end: at('2026-10-08T18:00:00Z') };
// Place Bellecour, Lyon; 200 m around it
const place = { lat: 45.7578, lng: 4.832, radiusM: 200 };
const near = { lat: 45.7588, lng: 4.832 }; // ~111 m north
const far = { lat: 45.7608, lng: 4.832 }; // ~334 m north

function room(overrides = {}) {
  return {
    id: 'room-id',
    ownerId: OWNER,
    visibility: 'public',
    accessPolicy: 'everyone',
    window: null,
    place: null,
    ...overrides,
  };
}

const during = { now: at('2026-10-08T17:00:00Z') };

test('roleOf: owner from rooms.owner_id, invited from room_members, otherwise null', () => {
  assert.equal(roleOf(room(), OWNER, false), 'owner');
  assert.equal(roleOf(room(), 'someone', true), 'invited');
  assert.equal(roleOf(room(), 'someone', false), null);
  assert.equal(roleOf(room(), null, false), null);
});

test('canView: public for everyone, private only for owner and invited users', () => {
  assert.equal(canView(room(), null), true);
  const priv = room({ visibility: 'private' });
  assert.equal(canView(priv, 'owner'), true);
  assert.equal(canView(priv, 'invited'), true);
  assert.equal(canView(priv, null), false);
});

test('canManage: owner only', () => {
  assert.equal(canManage(room(), 'owner'), true);
  assert.equal(canManage(room(), 'invited'), false);
  assert.equal(canManage(room(), null), false);
});

test('isWithinWindow: half-open interval, no window means no constraint', () => {
  assert.equal(isWithinWindow(null, at('2000-01-01T00:00:00Z')), true);
  assert.equal(isWithinWindow(window, at('2026-10-08T16:00:00Z')), true); // start included
  assert.equal(isWithinWindow(window, at('2026-10-08T17:59:59.999Z')), true);
  assert.equal(isWithinWindow(window, at('2026-10-08T18:00:00Z')), false); // end excluded
  assert.equal(isWithinWindow(window, at('2026-10-08T15:59:59.999Z')), false);
});

test('canVote: never on a room you cannot see, whatever the policy', () => {
  for (const accessPolicy of ['everyone', 'invited', 'place_time']) {
    const r = room({ visibility: 'private', accessPolicy, window, place });
    assert.deepEqual(canVote(r, null, during), { allowed: false, reason: DENY.NOT_VISIBLE });
  }
});

test('canVote everyone: any user who can see the room', () => {
  assert.deepEqual(canVote(room(), null, during), { allowed: true });
  assert.deepEqual(canVote(room({ visibility: 'private' }), 'invited', during), { allowed: true });
});

test('canVote invited: invited users and owner yes, other users of a public room no', () => {
  const r = room({ accessPolicy: 'invited' });
  assert.deepEqual(canVote(r, 'owner', during), { allowed: true });
  assert.deepEqual(canVote(r, 'invited', during), { allowed: true });
  assert.deepEqual(canVote(r, null, during), { allowed: false, reason: DENY.NOT_INVITED });
});

test('distanceM: haversine, symmetric, a degree of latitude is about 111 km', () => {
  assert.equal(distanceM(place, place), 0);
  const north = { lat: place.lat + 1, lng: place.lng };
  assert.ok(Math.abs(distanceM(place, north) - 111_195) < 10);
  assert.equal(distanceM(place, north), distanceM(north, place));
});

test('isWithinPlace: inside the radius, border included', () => {
  assert.equal(isWithinPlace(place, place), true);
  assert.equal(isWithinPlace(place, near), true);
  assert.equal(isWithinPlace(place, far), false);
  assert.equal(isWithinPlace({ ...place, radiusM: distanceM(place, far) }, far), true);
});

test('canVote place_time: anyone who can see the room, inside the window and the place', () => {
  const r = room({ accessPolicy: 'place_time', window, place });
  assert.deepEqual(canVote(r, null, { ...during, location: near }), { allowed: true });
  assert.deepEqual(canVote(r, 'invited', { ...during, location: near }), { allowed: true });
  for (const now of [at('2026-10-08T15:00:00Z'), at('2026-10-08T18:00:00Z')]) {
    assert.deepEqual(canVote(r, 'invited', { now, location: near }), {
      allowed: false,
      reason: DENY.OUTSIDE_TIME_WINDOW,
    });
  }
  assert.deepEqual(canVote(r, null, { ...during, location: far }), {
    allowed: false,
    reason: DENY.OUTSIDE_PLACE,
  });
  for (const location of [null, undefined]) {
    assert.deepEqual(canVote(r, null, { ...during, location }), {
      allowed: false,
      reason: DENY.LOCATION_REQUIRED,
    });
  }
});

test('canVote place_time: the owner is never restricted', () => {
  const r = room({ accessPolicy: 'place_time', window, place });
  assert.deepEqual(canVote(r, 'owner', { now: at('2026-10-08T10:00:00Z'), location: far }), {
    allowed: true,
  });
});

test('canVote: place_time without window or place, or an unknown policy, is refused', () => {
  for (const r of [
    room({ accessPolicy: 'place_time', window: null, place }),
    room({ accessPolicy: 'place_time', window, place: null }),
    room({ accessPolicy: 'time_window', window }),
    room({ accessPolicy: 'something_new' }),
  ]) {
    assert.deepEqual(canVote(r, null, { ...during, location: near }), {
      allowed: false,
      reason: DENY.MISCONFIGURED,
    });
  }
});

test('canRemoveMember: the owner removes anyone, a member only themselves', () => {
  assert.equal(canRemoveMember(room(), 'owner', OWNER, 'guest'), true);
  assert.equal(canRemoveMember(room(), 'invited', 'guest', 'guest'), true);
  assert.equal(canRemoveMember(room(), 'invited', 'guest', 'other-guest'), false);
  assert.equal(canRemoveMember(room(), null, 'stranger', 'stranger'), false);
  assert.equal(canRemoveMember(room(), null, 'stranger', 'guest'), false);
});
