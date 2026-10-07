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

    socket.on('unsubscribe', ({ roomId }) => socket.leave(`room:${roomId}`)); // temporaire roomId etc a decider
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
    await closeRedis();
  });
}

function verifyToken() {
  return true;
}

function canSee() {
  return true;
}
