// Playback state of a room, written by the owner phone (the only player) and read by the others.
// Redis only: it changes every few seconds and losing it costs a pause, not data.
const key = (roomId) => `playback:${roomId}`;
// A party lasts hours: the state of an abandoned room expires on its own
const TTL_SECONDS = 24 * 60 * 60;

// playing is the playing item from findPlaying. A state saved for another item (written just
// before a skip) is stale: the current track is then reported paused at 0.
export async function readPlayback(redis, roomId, playing) {
  if (playing == null) return null;
  const raw = await redis.get(key(roomId));
  const saved = raw ? JSON.parse(raw) : null;
  if (saved?.roomTrackId === playing.id) return { ...saved, at: new Date(saved.at) };
  return {
    roomTrackId: playing.id,
    trackId: playing.trackId,
    playing: false,
    positionMs: 0,
    at: new Date(),
  };
}

// at is the server time of the write: clients add (now - at) to positionMs while playing
export async function writePlayback(redis, roomId, playing, { playing: isPlaying, positionMs }) {
  const state = {
    roomTrackId: playing.id,
    trackId: playing.trackId,
    playing: isPlaying,
    positionMs,
    at: new Date(),
  };
  await redis.set(key(roomId), JSON.stringify(state), 'EX', TTL_SECONDS);
  return state;
}

export async function clearPlayback(redis, roomId) {
  await redis.del(key(roomId));
}
