const channel = (roomId) => `room:${roomId}`;

export function emitRoomChanged(io, room, change) {
  io?.to(channel(room.id)).emit('room.changed', {
    roomId: room.id,
    version: room.version,
    change,
  });
}

// playback is null when nothing plays
export function emitPlayback(io, roomId, playback, activeDeviceId = null) {
  io?.to(channel(roomId)).emit('room.playback', { roomId, playback, activeDeviceId });
}

export function emitPlaybackStop(io, roomId, deviceId) {
  io?.to(`device:${deviceId}`).emit('room.playback.stop', { roomId });
}

export function closeRoomChannel(io, roomId) {
  io?.in(channel(roomId)).socketsLeave(channel(roomId));
}

export function removeUserFromChannel(io, roomId, userId) {
  io?.in(`user:${userId}`).socketsLeave(channel(roomId));
}
