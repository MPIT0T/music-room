export const DENY = Object.freeze({
  NOT_OWNER: 'not_owner',
  CANNOT_DELEGATE_SELF: 'cannot_delegate_self',
  NOT_FRIEND: 'not_friend',
  NO_ACTIVE_DEVICE: 'no_active_device',
  NOT_DELEGATED: 'not_delegated',
  DELEGATION_EXPIRED: 'delegation_expired',
});

const ALLOWED = Object.freeze({ allowed: true });
const deny = (reason) => ({ allowed: false, reason });

export function isDelegationActive(delegation, now) {
  if (delegation == null) return false;
  if (delegation.expiresAt == null) return true;
  return now.getTime() < delegation.expiresAt.getTime();
}

export function canManageDelegations(device, userId) {
  return device.ownerId === userId;
}

export function canDelegateTo(device, actorId, delegateId, isFriend) {
  if (!canManageDelegations(device, actorId)) return deny(DENY.NOT_OWNER);
  if (delegateId === device.ownerId) return deny(DENY.CANNOT_DELEGATE_SELF);
  if (!isFriend) return deny(DENY.NOT_FRIEND);
  return ALLOWED;
}

export function canRevoke(device, actorId, delegateId) {
  return actorId === device.ownerId || actorId === delegateId;
}

export function canControl(ownerId, activeDevice, userId, delegation, ctx) {
  if (userId === ownerId) return ALLOWED;
  if (activeDevice == null) return deny(DENY.NO_ACTIVE_DEVICE);
  if (
    delegation == null ||
    delegation.deviceId !== activeDevice.id ||
    delegation.delegateId !== userId
  ) {
    return deny(DENY.NOT_DELEGATED);
  }
  if (!isDelegationActive(delegation, ctx.now)) return deny(DENY.DELEGATION_EXPIRED);
  return ALLOWED;
}

export function canTransfer(ownerId, targetDevice, userId) {
  if (userId !== ownerId) return deny(DENY.NOT_OWNER);
  if (targetDevice.ownerId !== ownerId) return deny(DENY.NOT_OWNER);
  return ALLOWED;
}
