import { z } from 'zod';
import { safeText } from '../validation.js';

const broadcastPayload = z.object({
  roomId: z.string().max(64),
  text: safeText({ min: 1, max: 500 }),
});

// Development only (see socketSetup): the playground sends a message to everyone subscribed to a room.
// Real room events (room.changed) are emitted by the server after a write, never relayed from a client.
export function devBroadcastHandler(io, socket) {
  return (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const parsed = broadcastPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: 'INVALID' });

    const { roomId, text } = parsed.data;
    const channel = `room:${roomId}`;
    // Only sockets that passed the subscribe check (canView) are in the channel
    if (!socket.rooms.has(channel)) return reply({ ok: false, code: 'NOT_SUBSCRIBED' });

    // Through the Redis adapter: reaches subscribers connected to any API instance
    io.to(channel).emit('dev:message', {
      roomId,
      from: socket.data.userId,
      text,
      sentAt: new Date().toISOString(),
    });
    reply({ ok: true });
  };
}
