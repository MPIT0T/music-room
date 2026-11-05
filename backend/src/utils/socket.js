import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub } from './redis.js';
import { clientHeader, parseUserAgent } from '../logger.js';
import { MAX_SOCKETS_PER_USER, MAX_SOCKET_MESSAGE_BYTES } from '../security/limits.js';
import { loadVisibleRoom } from '../rooms/guards.js';
import { devBroadcastHandler } from '../dev/socket.js';

// Same client context as the HTTP logs: platform, model and app version
const clientContext = (socket) => parseUserAgent(socket.handshake.headers?.['user-agent']);

export function authenticateSocket(tokens, log, { rateLimiter, limits } = {}) {
  return async (socket, next) => {
    try {
      const { userId, deviceId } = await tokens.verifyAccessToken(socket.handshake.auth?.token);
      socket.data.userId = userId;
      socket.data.deviceId = deviceId;
      next();
    } catch (err) {
      // No account behind these: without a cap, anyone could fill the logs for free
      const logged = await rateLimiter?.consume(limits.socketRejectedLog, socket.handshake.address);
      if (logged?.allowed !== false) {
        // err.message is a fixed text or a jose code: the token itself is never logged
        log?.warn(
          { ...clientContext(socket), result: 'rejected', reason: err.message },
          'socket handshake rejected',
        );
      }
      next(new Error('unauthorized'));
    }
  };
}

// After authenticateSocket. Socket.IO only connects a tick after next(), so the room is joined
// here: sockets opened in a burst count each other, and a refused one has nothing to undo.
// Counted on this instance only: with several, the real cap is this limit on each of them.
export function limitConnections(io, { rateLimiter, limits, log }) {
  return async (socket, next) => {
    const { userId, deviceId } = socket.data;
    const refuse = (result) => {
      log?.warn(
        { userId, deviceId, ...clientContext(socket), result },
        'socket connection refused',
      );
      next(new Error(result));
    };

    const rate = await rateLimiter?.consume(limits.socketConnect, userId);
    if (rate?.allowed === false) return refuse('rate_limited');

    const open = io.sockets.adapter.rooms.get(`user:${userId}`)?.size ?? 0;
    if (open >= MAX_SOCKETS_PER_USER) return refuse('too_many_connections');
    socket.join(`user:${userId}`);
    next();
  };
}

export function socketSetup(
  httpServer,
  { tokens, db, log, rateLimiter, limits, devTools = false },
) {
  const io = new Server(httpServer, {
    cors: { origin: false },
    maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES,
  });
  io.adapter(createAdapter(pub, sub));

  io.use(authenticateSocket(tokens, log, { rateLimiter, limits }));
  io.use(limitConnections(io, { rateLimiter, limits, log }));

  io.on('connection', (socket) => {
    handleConnection(socket, { db, log, rateLimiter, limits });
    if (devTools) socket.on('dev:broadcast', devBroadcastHandler(io, socket));
  });

  io.on('close', () => {});

  return io;
}

export function handleConnection(socket, { db, log, rateLimiter, limits }) {
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

  const allowSubscribe = async () =>
    (await rateLimiter?.consume(limits.socketSubscribe, userId))?.allowed !== false;

  socket.on('subscribe', subscribeHandler(socket, db, socketLog, allowSubscribe));
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

export function subscribeHandler(socket, db, log, allowed = async () => true) {
  return async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const roomId = clientHeader(payload?.roomId);
    try {
      if (!(await allowed())) {
        log?.warn({ roomId, result: 'rate_limited' }, 'socket subscribe');
        return reply({ ok: false, code: 'RATE_LIMITED' });
      }
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
