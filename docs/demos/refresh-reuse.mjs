// Demo: replaying a stolen refresh token (threat-model.md, section 2).
// Usage: EMAIL=<verified account> PASSWORD=<its password> node docs/demos/refresh-reuse.mjs
//        (API_URL=http://<host>:3000 to target another server)
//
// The victim refreshes normally, then the attacker replays the old token:
//   - within 10 s: 409 refresh_conflict (two tabs refreshing together), nothing is revoked;
//   - after 10 s: 401 refresh_token_reused, and the server revokes the session of that device.
// The victim's current token stops working too: both must sign in again.

const api = process.env.API_URL ?? 'http://localhost:3000';
const { EMAIL: email, PASSWORD: password } = process.env;
if (!email || !password) {
  console.error('Set EMAIL and PASSWORD of a verified test account.');
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const refresh = (refreshToken) => post('/v1/sessions/refresh', { refreshToken });

function show(step, { status, body }) {
  console.log(`${step}: ${status} ${body.code ?? 'ok'}`);
}

const login = await post('/v1/sessions', {
  email,
  password,
  device: { name: 'refresh-reuse demo', platform: 'web' },
});
show('Victim signs in', login);
if (login.status !== 200) process.exit(1);
const stolen = login.body.refreshToken;
console.log('  (the attacker copies this refresh token)\n');

const rotated = await refresh(stolen);
show('Victim refreshes, gets a new token', rotated);
const current = rotated.body.refreshToken;

show('Attacker replays the old token at once', await refresh(stolen));
console.log('  (within 10 s this looks like two tabs refreshing: nothing revoked)\n');

console.log('Waiting 11 s...');
await new Promise((resolve) => setTimeout(resolve, 11_000));

show('Attacker replays the old token again', await refresh(stolen));
show("Victim's current token", await refresh(current));
console.log('\nReuse detected: the device session is revoked, everyone signs in again.');
