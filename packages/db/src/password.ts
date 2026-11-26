import argon2 from 'argon2';

/** OWASP's argon2id parameters: 19 MiB, two passes. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  argon2.verify(hash, password);
