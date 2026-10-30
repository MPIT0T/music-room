// Scenario: each virtual user opens a socket, subscribes to its room and stays connected.
// Measures how many simultaneous room listeners the API holds.
import { check, fail } from 'k6';
import { SharedArray } from 'k6/data';
import { connect } from './lib/socketio.js';

const API_URL = __ENV.API_URL ?? 'http://api:3000';
const VUS = Number(__ENV.VUS ?? 50);
const HOLD_SECONDS = Number(__ENV.HOLD ?? 20);

// Read once and shared by every VU instead of one copy each
const data = JSON.parse(open('./.data.json'));
const users = new SharedArray('users', () => data.users);

export const options = {
  scenarios: {
    listeners: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: VUS },
        { duration: '1m', target: VUS },
        { duration: '10s', target: 0 },
      ],
      // Let the last sockets finish their hold instead of cutting them mid-way
      gracefulRampDown: `${HOLD_SECONDS + 10}s`,
      gracefulStop: `${HOLD_SECONDS + 10}s`,
    },
  },
  // The limits from Technical Requirements: past them, this VU count is not supported
  thresholds: {
    socketio_connect_duration: ['p(95)<500'],
    socketio_ack_duration: ['p(95)<500'],
    socketio_errors: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  if (users.length < VUS) fail(`${VUS} VUs but only ${users.length} users: rerun load-seed.js`);
  if (new Date(data.expiresAt) < new Date(Date.now() + 3 * 60 * 1000)) {
    fail('access tokens expire before the end of the test (3 min): rerun load-seed.js');
  }
}

export default async function () {
  // One user per VU, so no user has two sockets at once
  const user = users[(__VU - 1) % users.length];
  let socket;
  try {
    socket = await connect(API_URL, user.token);
  } catch {
    // Already counted in socketio_errors; wait before retrying so a dead API is not hammered
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return;
  }
  const ack = await socket.emit('subscribe', { roomId: user.roomId }).catch(() => null);
  check(ack, { 'subscribe ok': (a) => a?.ok === true });
  setTimeout(() => socket.close(), HOLD_SECONDS * 1000);
}
