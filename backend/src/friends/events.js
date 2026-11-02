export function emitFriendsChanged(io, userId, otherId, status) {
  io?.to('user:' + userId).emit('friends.changed', { userId: otherId, status });
  io?.to('user:' + otherId).emit('friends.changed', { userId, status });
}
