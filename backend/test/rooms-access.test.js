import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENY, canManage, canView, canVote, isWithinWindow, roleOf } from '../src/rooms/access.js';

const OWNER = 'owner-id';
const at = (iso) => new Date(iso);

// 16:00 to 18:00 UTC
const window = { start: at('2026-10-08T16:00:00Z'), end: at('2026-10-08T18:00:00Z') };

function room(overrides = {}) {
  return {
    id: 'room-id',
    ownerId: OWNER,
    visibility: 'public',
    accessPolicy: 'everyone',
    window: null,
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
  for (const accessPolicy of ['everyone', 'invited', 'time_window']) {
    const r = room({ visibility: 'private', accessPolicy, window });
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

test('canVote time_window: anyone who can see the room, inside the window only', () => {
  const r = room({ accessPolicy: 'time_window', window });
  assert.deepEqual(canVote(r, null, during), { allowed: true });
  assert.deepEqual(canVote(r, 'invited', during), { allowed: true });
  for (const now of [at('2026-10-08T15:00:00Z'), at('2026-10-08T18:00:00Z')]) {
    assert.deepEqual(canVote(r, 'invited', { now }), {
      allowed: false,
      reason: DENY.OUTSIDE_TIME_WINDOW,
    });
  }
});

test('canVote time_window: the owner is never restricted', () => {
  const r = room({ accessPolicy: 'time_window', window });
  assert.deepEqual(canVote(r, 'owner', { now: at('2026-10-08T10:00:00Z') }), { allowed: true });
});

test('canVote: time_window without window or unknown policy is refused, never opened', () => {
  for (const r of [
    room({ accessPolicy: 'time_window', window: null }),
    room({ accessPolicy: 'something_new' }),
  ]) {
    assert.deepEqual(canVote(r, null, during), { allowed: false, reason: DENY.MISCONFIGURED });
  }
});
