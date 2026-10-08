import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub } from './redis.js';
import { loadVisibleRoom } from '../rooms/guards.js';

export function authenticateSocket(tokens, log) {
  return async (socket, next) => {
    try {
      const { userId, deviceId } = await tokens.verifyAccessToken(socket.handshake.auth?.token);
      socket.data.userId = userId;
      socket.data.deviceId = deviceId;
      next();
    } catch (err) {
      log?.debug({ reason: err.message }, 'socket handshake rejected');
      // Same answer whatever the reason: the client only needs to know it must refresh
      next(new Error('unauthorized'));
    }
  };
}

export function socketSetup(httpServer, { tokens, db, log }) {
  const io = new Server(httpServer, { cors: { origin: false } });
  io.adapter(createAdapter(pub, sub));

  io.use(authenticateSocket(tokens, log));

  io.on('connection', (socket) => {
    // Lets logout and password reset disconnect one device or all of a user's devices, on every instance
    socket.join([`user:${socket.data.userId}`, `device:${socket.data.deviceId}`]);

    socket.on('subscribe', subscribeHandler(socket, db, log));
    socket.on('unsubscribe', (payload) => {
      if (typeof payload?.roomId === 'string') socket.leave(`room:${payload.roomId}`);
    });
  });

  io.on('close', () => {});

  return io;
}

export function handleSocketClosing(app, io) {
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    await io.close();
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });
}

// Joins `room:<id>` only if the user can see the room. Unknown, private and malformed ids
// all get the same NOT_FOUND, like the REST routes' 404.
export function subscribeHandler(socket, db, log) {
  return async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const visible = await loadVisibleRoom(db, payload?.roomId, socket.data.userId);
      if (visible == null) return reply({ ok: false, code: 'NOT_FOUND' });
      socket.join(`room:${visible.room.id}`);
      reply({ ok: true, version: visible.room.version });
    } catch (err) {
      log?.error({ err, roomId: payload?.roomId }, 'socket subscribe failed');
      reply({ ok: false, code: 'INTERNAL' });
    }
  };
}
