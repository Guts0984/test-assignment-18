import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Tests against a running compose stack, started from the same file.
process.env['ENV_FILE'] ??= '.env.test';
if (existsSync(process.env['ENV_FILE'])) process.loadEnvFile(process.env['ENV_FILE']);

export default defineConfig({
  test: {
    include: ['tests/**/*.x.spec.ts'],
    environment: 'node',
    // One stack and one clock: files run one at a time.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
