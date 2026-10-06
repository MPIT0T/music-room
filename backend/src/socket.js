import {Server} from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import redis from './redis.js';

function attachRealtime(httpServer, { verifyToken, canSee }) {
  const io = new Server(httpServer, { cors: { origin: false } });
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate())); // 2 clients : pub et sub

  // Le token est vérifié au handshake, avant toute connexion
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
    socket.on('subscribe', async ({ roomId }, ack) => {
      if (!(await canSee(socket.data.userId, roomId))) {
        return ack?.({ ok: false, code: 'NOT_FOUND' });
      }
      socket.join(`room:${roomId}`);
      ack?.({ ok: true });
    });
    socket.on('unsubscribe', ({ roomId }) => socket.leave(`room:${roomId}`));
  });

  return io;
}


export function socketSetup(app) {
    const io = attachRealtime(app.server, { verifyToken, canSee });

}