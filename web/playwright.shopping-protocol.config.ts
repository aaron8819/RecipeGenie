import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'shopping-protocol.spec.ts', workers: 1,
  timeout: 180000, reporter: [['list']],
  outputDir: '../.codex-artifacts/slice6/browser',
  use: { baseURL: 'http://127.0.0.1:3116', trace: 'off', video: 'off', screenshot: 'off' },
});
