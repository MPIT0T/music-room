import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DENY,
  canControl,
  canDelegateTo,
  canManageDelegations,
  canRevoke,
  canTransfer,
  isDelegationActive,
} from '../src/delegation/access.js';

const OWNER = 'owner-id';
const FRIEND = 'friend-id';
const OTHER = 'other-id';
const at = (iso) => new Date(iso);
const now = at('2026-11-04T12:00:00Z');
const ctx = { now };

const pc = { id: 'pc-id', ownerId: OWNER };
const phone = { id: 'phone-id', ownerId: OWNER };
const friendPhone = { id: 'friend-phone-id', ownerId: FRIEND };

function delegation(overrides = {}) {
  return { deviceId: pc.id, delegateId: FRIEND, expiresAt: null, ...overrides };
}

const allowed = { allowed: true };
const denied = (reason) => ({ allowed: false, reason });

test('isDelegationActive: none, permanent, before and after expiry', () => {
  assert.equal(isDelegationActive(null, now), false);
  assert.equal(isDelegationActive(delegation(), now), true);
  assert.equal(
    isDelegationActive(delegation({ expiresAt: at('2026-11-04T13:00:00Z') }), now),
    true,
  );
  // The expiry instant itself is already expired
  assert.equal(isDelegationActive(delegation({ expiresAt: now }), now), false);
  assert.equal(
    isDelegationActive(delegation({ expiresAt: at('2026-11-04T11:00:00Z') }), now),
    false,
  );
});

test('canManageDelegations: owner only', () => {
  assert.equal(canManageDelegations(pc, OWNER), true);
  assert.equal(canManageDelegations(pc, FRIEND), false);
});

test('canDelegateTo: owner, to a friend, never to himself', () => {
  assert.deepEqual(canDelegateTo(pc, OWNER, FRIEND, true), allowed);
  assert.deepEqual(canDelegateTo(pc, FRIEND, OTHER, true), denied(DENY.NOT_OWNER));
  assert.deepEqual(canDelegateTo(pc, OWNER, OWNER, false), denied(DENY.CANNOT_DELEGATE_SELF));
  assert.deepEqual(canDelegateTo(pc, OWNER, OTHER, false), denied(DENY.NOT_FRIEND));
});

test('canRevoke: the owner or the delegate himself', () => {
  assert.equal(canRevoke(pc, OWNER, FRIEND), true);
  assert.equal(canRevoke(pc, FRIEND, FRIEND), true);
  assert.equal(canRevoke(pc, OTHER, FRIEND), false);
});

test('canControl: the owner controls from any device, even with no active device', () => {
  assert.deepEqual(canControl(OWNER, pc, OWNER, null, ctx), allowed);
  assert.deepEqual(canControl(OWNER, null, OWNER, null, ctx), allowed);
});

test('canControl: a friend needs a live delegation on the active device', () => {
  assert.deepEqual(canControl(OWNER, pc, FRIEND, delegation(), ctx), allowed);
  assert.deepEqual(
    canControl(OWNER, null, FRIEND, delegation(), ctx),
    denied(DENY.NO_ACTIVE_DEVICE),
  );
  assert.deepEqual(canControl(OWNER, pc, FRIEND, null, ctx), denied(DENY.NOT_DELEGATED));
  assert.deepEqual(
    canControl(OWNER, pc, FRIEND, delegation({ expiresAt: at('2026-11-04T11:00:00Z') }), ctx),
    denied(DENY.DELEGATION_EXPIRED),
  );
});

test('canControl: a delegation on another device or for another user gives nothing', () => {
  // Sound moved to the phone, the friend only has the PC
  assert.deepEqual(canControl(OWNER, phone, FRIEND, delegation(), ctx), denied(DENY.NOT_DELEGATED));
  assert.deepEqual(canControl(OWNER, pc, OTHER, delegation(), ctx), denied(DENY.NOT_DELEGATED));
});

test('canTransfer: the owner, to his own devices only', () => {
  assert.deepEqual(canTransfer(OWNER, phone, OWNER), allowed);
  assert.deepEqual(canTransfer(OWNER, phone, FRIEND), denied(DENY.NOT_OWNER));
  assert.deepEqual(canTransfer(OWNER, friendPhone, OWNER), denied(DENY.NOT_OWNER));
});
