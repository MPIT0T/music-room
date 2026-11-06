export async function isDeviceOnline(io, deviceId) {
  if (io == null) return false;
  const sockets = await io.in(`device:${deviceId}`).fetchSockets();
  return sockets.length > 0;
}
