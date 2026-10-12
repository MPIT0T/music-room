import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

// OWASP minimum for argon2id: 19 MiB of memory, 2 iterations, 1 lane
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Checked when there is no hash to compare with (unknown email, Google-only account),
// so that answer takes as long as a wrong password. Built once, on first use.
let dummyHash;
const getDummyHash = () =>
  (dummyHash ??= argon2.hash(randomBytes(32).toString('base64url'), OPTIONS));

export const passwords = {
  hash: (plain) => argon2.hash(plain, OPTIONS),
  // hash may be null: the dummy is verified instead and the answer is always false
  async verify(hash, plain) {
    if (!hash) {
      await argon2.verify(await getDummyHash(), plain);
      return false;
    }
    return argon2.verify(hash, plain);
  },
};
