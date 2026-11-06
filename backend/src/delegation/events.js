export function emitDelegationsChanged(io, { ownerId, delegateId, deviceId, status }) {
  const data = { deviceId, ownerId, userId: delegateId, status };
  io?.to(`user:${ownerId}`).emit('delegations.changed', data);
  io?.to(`user:${delegateId}`).emit('delegations.changed', data);
}
