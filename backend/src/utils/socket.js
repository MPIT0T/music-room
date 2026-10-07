import {Server} from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import redis from './redis.js';

export function socketSetup(httpServer) {
  const io = new Server(httpServer, { cors: { origin: false } });
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate())); 

  io.use(async (socket, next) => {
    try {
      const claims = await verifyToken(socket.handshake.auth?.token);
      socket.data.userId = claims.sub;
      socket.data.deviceId = claims.did;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('subscribe', async ({ roomId }, toEmit) => {
      if (!(await canSee(socket.data.userId, roomId))) {
        return toEmit?.({ ok: false, code: 'NOT_FOUND' });
      }
      socket.join(`room:${roomId}`);
      toEmit?.({ ok: true });
    });
    socket.on('unsubscribe', ({ roomId }) => socket.leave(`room:${roomId}`)); // temporaire roomId etc a decider
  });

  io.on('close', (socket) => {});
  return io;
}

function verifyToken(token) {
  return true;
}

function canSee(userId, roomId) {
  return true;
}