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

// The device the sound of a room comes out of (one of the owner's devices), kept apart from the
// state: it survives skips and an empty queue, and only the owner changes it.
const deviceKey = (roomId) => `playback-device:${roomId}`;
// Reverse index: the rooms a device was made the player of. Read when the device goes offline,
// to pause what it was playing without scanning every room.
const roomsKey = (deviceId) => `device-rooms:${deviceId}`;

export async function readActiveDevice(redis, roomId) {
  return redis.get(deviceKey(roomId));
}

export async function writeActiveDevice(redis, roomId, deviceId) {
  await redis
    .multi()
    .set(deviceKey(roomId), deviceId, 'EX', TTL_SECONDS)
    .sadd(roomsKey(deviceId), roomId)
    .expire(roomsKey(deviceId), TTL_SECONDS)
    .exec();
}

// SET NX: two owner devices pressing play at once, the first one becomes the player.
// Returns the active device after the call.
export async function claimActiveDevice(redis, roomId, deviceId) {
  const [[, claimed]] = await redis
    .multi()
    .set(deviceKey(roomId), deviceId, 'EX', TTL_SECONDS, 'NX')
    .exec();
  if (claimed === 'OK') {
    await redis
      .multi()
      .sadd(roomsKey(deviceId), roomId)
      .expire(roomsKey(deviceId), TTL_SECONDS)
      .exec();
    return deviceId;
  }
  return readActiveDevice(redis, roomId);
}

export async function clearActiveDevice(redis, roomId) {
  await redis.del(deviceKey(roomId));
}

// The device lost its last socket: every room it still plays is paused where it was, so remotes
// stop their progress bar. Returns [{ roomId, playback }] for the rooms that changed.
// Not atomic with a command sent at the very same moment: the later write wins, which at worst
// leaves one state the device never played; the next command or transfer fixes it.
export async function pauseRoomsOfDevice(redis, deviceId, now = new Date()) {
  const roomIds = await redis.smembers(roomsKey(deviceId));
  const paused = [];
  for (const roomId of roomIds) {
    if ((await readActiveDevice(redis, roomId)) !== deviceId) {
      // Transferred since, or room deleted: forget it
      await redis.srem(roomsKey(deviceId), roomId);
      continue;
    }
    const raw = await redis.get(key(roomId));
    const saved = raw ? JSON.parse(raw) : null;
    if (saved == null || !saved.playing) continue;

    const positionMs = saved.positionMs + Math.max(0, now.getTime() - Date.parse(saved.at));
    const state = { ...saved, playing: false, positionMs, at: now };
    await redis.set(key(roomId), JSON.stringify(state), 'EX', TTL_SECONDS);
    paused.push({ roomId, playback: state });
  }
  return paused;
}
