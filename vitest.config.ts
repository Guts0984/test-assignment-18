import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.spec.ts'],
          exclude: ['**/*.it.spec.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{packages,apps}/*/{src,test}/**/*.it.spec.ts'],
          globalSetup: ['./vitest.database.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
