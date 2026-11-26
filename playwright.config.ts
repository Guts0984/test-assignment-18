import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the running compose stack, started from the same file.
process.env['ENV_FILE'] ??= '.env.test';
if (existsSync(process.env['ENV_FILE'])) process.loadEnvFile(process.env['ENV_FILE']);

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${process.env['HTTP_PORT'] ?? '8080'}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    // These never move the shared clock, so they run side by side.
    { name: 'static', testMatch: /\.static\.e2e\.ts$/, fullyParallel: true },
    // These move it, so they run afterwards, one at a time.
    { name: 'clock', testMatch: /\.journey\.e2e\.ts$/, dependencies: ['static'], workers: 1 },
  ],
});
