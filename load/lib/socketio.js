// Minimal Socket.IO v4 client for k6, which only speaks raw WebSocket.
// Wire format (Engine.IO packet type, then Socket.IO packet type, then JSON):
//   server -> 0{...}            Engine.IO open, then we connect to the "/" namespace
//   client -> 40{"token":"..."} namespace connect with the auth payload (handshake.auth)
//   server -> 40{"sid":"..."}   connected        44{"message":"..."}  refused by the middleware
//   client -> 42<id>["event",data]  emit expecting an ack with that id
//   server -> 43<id>[data]          the ack
//   server -> 42["event",data]      event broadcast to us
//   server -> 2 / client -> 3       heartbeat: without the pong the server drops us
import { WebSocket } from 'k6/websockets';
import { Trend, Rate } from 'k6/metrics';

export const connectDuration = new Trend('socketio_connect_duration', true);
export const ackDuration = new Trend('socketio_ack_duration', true);
export const socketErrors = new Rate('socketio_errors');

export function connect(apiUrl, token, { timeoutMs = 10000 } = {}) {
  const ws = new WebSocket(`${apiUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`);
  const started = Date.now();
  const pending = new Map();
  const listeners = new Map();
  let nextAckId = 0;

  const socket = {
    // Resolves with the ack payload, rejects on timeout or if the socket closes first
    emit(event, data) {
      const id = nextAckId++;
      const sent = Date.now();
      ws.send(`42${id}${JSON.stringify([event, data])}`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`no ack for ${event}`));
        }, timeoutMs);
        pending.set(id, (payload) => {
          clearTimeout(timer);
          ackDuration.add(Date.now() - sent, { event });
          resolve(payload);
        });
      });
    },
    on(event, fn) {
      listeners.set(event, fn);
    },
    close() {
      ws.close();
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socketErrors.add(1);
      ws.close();
      reject(new Error('socket.io connect timeout'));
    }, timeoutMs);

    ws.onmessage = (e) => {
      const msg = String(e.data);
      if (msg === '2') return ws.send('3');
      if (msg[0] === '0') return ws.send(`40${JSON.stringify({ token })}`);
      if (msg.startsWith('40')) {
        clearTimeout(timer);
        connectDuration.add(Date.now() - started);
        socketErrors.add(0);
        return resolve(socket);
      }
      if (msg.startsWith('44')) {
        clearTimeout(timer);
        socketErrors.add(1);
        ws.close();
        return reject(new Error(`socket.io refused: ${msg.slice(2)}`));
      }
      if (msg.startsWith('43')) {
        const [, id, body] = msg.match(/^43(\d+)(.*)$/);
        const done = pending.get(Number(id));
        pending.delete(Number(id));
        if (done) done(JSON.parse(body)[0]);
        return;
      }
      if (msg.startsWith('42')) {
        const [event, data] = JSON.parse(msg.slice(2));
        listeners.get(event)?.(data);
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      socketErrors.add(1);
      reject(new Error(`websocket error: ${e.error}`));
    };
  });
}
