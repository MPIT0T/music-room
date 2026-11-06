// Demo: password brute force against POST /v1/sessions (threat-model.md, section 1).
// Usage: node docs/demos/brute-force.mjs [email]
//        API_URL=http://<host>:3000 node docs/demos/brute-force.mjs
//
// Sends wrong passwords for one email. The first 5 get 401, the 6th gets 429 with
// Retry-After: the login rule allows 5 attempts per IP and email every 15 minutes.
// The email does not need to exist: the answer is the same, and no real account is locked.

const api = process.env.API_URL ?? 'http://localhost:3000';
const email = process.argv[2] ?? `brute-force-${Date.now()}@musicroom.test`;
const attempts = 8;

console.log(`Target: ${api}/v1/sessions, email ${email}\n`);

for (let i = 1; i <= attempts; i++) {
  const res = await fetch(`${api}/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: `wrong-password-${i}`,
      device: { name: 'brute-force demo', platform: 'web' },
    }),
  });
  const { code } = await res.json();
  const retryAfter = res.headers.get('retry-after');
  const wait = retryAfter ? `, retry after ${retryAfter} s` : '';
  console.log(`Attempt ${i}: ${res.status} ${code}${wait}`);
}

console.log('\nBlocked: even the right password now gets 429 until the window ends.');
