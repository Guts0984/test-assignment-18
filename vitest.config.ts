import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

/** NestJS needs decorator metadata, which Vitest's default transform drops. */
const decorators = () =>
  swc.vite({
    module: { type: 'es6' },
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
    },
  });

/** Suites that boot real servers against real Postgres and Redis. */
const realServices = (name: string, include: string[]) => ({
  plugins: [decorators()],
  test: {
    name,
    include,
    globalSetup: ['./vitest.database.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{packages,apps}/*/src/**/*.spec.ts'],
          exclude: ['**/*.it.spec.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      realServices('integration', ['{packages,apps}/*/{src,test}/**/*.it.spec.ts']),
      realServices('adversarial', ['apps/api/test/adv/**/*.adv.spec.ts']),
      // Spawns worker processes and wipes its Redis database, so files run one at a time.
      {
        ...realServices('chaos', ['apps/worker/test/adv/**/*.adv.spec.ts']),
        test: {
          ...realServices('chaos', ['apps/worker/test/adv/**/*.adv.spec.ts']).test,
          fileParallelism: false,
          testTimeout: 180_000,
        },
      },
    ],
  },
});
