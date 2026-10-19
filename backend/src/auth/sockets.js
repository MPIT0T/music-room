// io is attached in server.js after buildApp: absent in tests and scripts, nothing to close then.
// The Redis adapter forwards the call, so sockets on every API instance are closed.
export function disconnectDevice(app, deviceId) {
  app.io?.in(`device:${deviceId}`).disconnectSockets(true);
}
