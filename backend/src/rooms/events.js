const channel = (roomId) => `room:${roomId}`;

export function emitRoomChanged(io, room, change) {
  io?.to(channel(room.id)).emit('room.changed', {
    roomId: room.id,
    version: room.version,
    change,
  });
}

export function closeRoomChannel(io, roomId) {
  io?.in(channel(roomId)).socketsLeave(channel(roomId));
}

export function removeUserFromChannel(io, roomId, userId) {
  io?.in(`user:${userId}`).socketsLeave(channel(roomId));
}
