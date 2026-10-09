import argon2 from 'argon2';

// OWASP minimum for argon2id: 19 MiB of memory, 2 iterations, 1 lane
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const passwords = {
  hash: (plain) => argon2.hash(plain, OPTIONS),
  verify: (hash, plain) => argon2.verify(hash, plain),
};
