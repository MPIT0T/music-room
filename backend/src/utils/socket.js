import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub, closeRedis } from './redis.js';

export function socketSetup(httpServer) {
  const io = new Server(httpServer, { cors: { origin: false } });
  io.adapter(createAdapter(pub, sub)); 

  io.use(async (socket, next) => {
    try {
      const claims = await verifyToken(socket.handshake.auth?.token);

      socket.data.userId = claims.sub;
      socket.data.deviceId = claims.did;

      next();
    } catch (err) {
      const e = new Error('unauthorized');
      e.data = { reason: err.message };
      next(e);
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

    socket.on('message', ({ roomId, text } = {}, ack) => {
      const room = `room:${roomId}`;
      if (!socket.rooms.has(room)) {
        return ack?.({ ok: false, code: 'NOT_SUBSCRIBED' });
      }
      io.to(room).emit('message', {
        roomId,
        from: socket.data.userId,
        text: `msg from server: ${String(text ?? '')}`,
        at: Date.now(),
      });
      ack?.({ ok: true });
    });
  });

  io.on('close', (socket) => {});

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

// TODO: remplacer par la vraie verification JWT (JWT_SECRET) quand l'auth sera en place.
// Stub dev : le token sert directement d'userId, pour simuler plusieurs users depuis le front de test.
async function verifyToken(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('missing token');
  }
  return { sub: token.trim(), did: 'dev' };
}

function canSee(userId, roomId) {
  return true;
}