import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub } from './redis.js';
import { clientHeader, parseUserAgent } from '../logger.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import { devBroadcastHandler } from '../dev/socket.js';
import { isDeviceOnline } from '../devices/presence.js';
import { emitPlayback } from '../rooms/events.js';
import { pauseRoomsOfDevice } from '../rooms/playback.js';

// Same client context as the HTTP logs: platform, model and app version
const clientContext = (socket) => parseUserAgent(socket.handshake.headers?.['user-agent']);

export function authenticateSocket(tokens, log) {
  return async (socket, next) => {
    try {
      const { userId, deviceId } = await tokens.verifyAccessToken(socket.handshake.auth?.token);
      socket.data.userId = userId;
      socket.data.deviceId = deviceId;
      next();
    } catch (err) {
      // err.message is a fixed text or a jose code: the token itself is never logged
      log?.warn(
        { ...clientContext(socket), result: 'rejected', reason: err.message },
        'socket handshake rejected',
      );
      next(new Error('unauthorized'));
    }
  };
}

export function socketSetup(httpServer, { tokens, db, log, devTools = false, redis }) {
  const io = new Server(httpServer, { cors: { origin: false } });
  io.adapter(createAdapter(pub, sub));

  io.use(authenticateSocket(tokens, log));

  io.on('connection', (socket) => {
    handleConnection(socket, { db, log });
    if (devTools) socket.on('dev:broadcast', devBroadcastHandler(io, socket));
    socket.on('disconnect', deviceOfflineHandler(io, redis, socket, log));
  });

  io.on('close', () => {});

  return io;
}

export function handleConnection(socket, { db, log }) {
  const { userId, deviceId } = socket.data;
  // Every line about this connection says who, from which device and app version
  const socketLog = log?.child({
    socketId: socket.id,
    userId,
    deviceId,
    ...clientContext(socket),
  });
  const connectedAt = Date.now();

  socket.join([`user:${userId}`, `device:${deviceId}`]);
  socketLog?.info({ result: 'ok' }, 'socket connected');

  socket.on('subscribe', subscribeHandler(socket, db, socketLog));
  socket.on('unsubscribe', unsubscribeHandler(socket, socketLog));
  socket.on('disconnect', (reason) => {
    socketLog?.info({ reason, durationMs: Date.now() - connectedAt }, 'socket disconnected');
  });
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

export function subscribeHandler(socket, db, log) {
  return async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const roomId = clientHeader(payload?.roomId);
    try {
      const visible = await loadVisibleRoom(db, payload?.roomId, socket.data.userId);
      if (visible == null) {
        log?.warn({ roomId, result: 'not_found' }, 'socket subscribe');
        return reply({ ok: false, code: 'NOT_FOUND' });
      }
      socket.join(`room:${visible.room.id}`);
      log?.info({ roomId: visible.room.id, result: 'ok' }, 'socket subscribe');
      reply({ ok: true, version: visible.room.version });
    } catch (err) {
      log?.error({ err, roomId, result: 'error' }, 'socket subscribe');
      reply({ ok: false, code: 'INTERNAL' });
    }
  };
}

export function deviceOfflineHandler(io, redis, socket, log) {
  return async () => {
    const { deviceId } = socket.data;
    try {
      if (redis == null || (await isDeviceOnline(io, deviceId))) return;
      for (const { roomId, playback } of await pauseRoomsOfDevice(redis, deviceId)) {
        emitPlayback(io, roomId, playback, deviceId);
        log?.info({ roomId, deviceId }, 'playing device offline, playback paused');
      }
    } catch (err) {
      log?.error({ err, deviceId }, 'pause on disconnect failed');
    }
  };
}

export function unsubscribeHandler(socket, log) {
  return (payload) => {
    const roomId = clientHeader(payload?.roomId);
    if (typeof payload?.roomId !== 'string') {
      log?.warn({ roomId, result: 'invalid' }, 'socket unsubscribe');
      return;
    }
    const channel = `room:${payload.roomId}`;
    const result = socket.rooms.has(channel) ? 'ok' : 'not_subscribed';
    socket.leave(channel);
    log?.info({ roomId, result }, 'socket unsubscribe');
  };
}
