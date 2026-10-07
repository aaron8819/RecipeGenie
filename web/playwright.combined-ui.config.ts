import { defineConfig } from '@playwright/test';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Combined qualification cannot launch on a shared/local runner');
}

export default defineConfig({
  testDir: './qualification',
  testMatch: 'combined-ui.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  globalTimeout: 1_500_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3107',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'combined-chromium', use: { browserName: 'chromium' } },
    { name: 'combined-webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: 'npm start -- --hostname 127.0.0.1 --port 3108',
      url: 'http://127.0.0.1:3108/login',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'npm run local:production -- --port 3107 --upstream-port 3108',
      url: 'http://127.0.0.1:3107/login',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ],
});
