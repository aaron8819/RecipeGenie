import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['shopping-slice7.spec.ts', 'shopping-corrections.spec.ts', 'shopping-protocol.spec.ts'], workers: 1,
  timeout: 180000, reporter: [['list']], outputDir: '../.codex-artifacts/slice7/browser',
  use: { baseURL: 'http://127.0.0.1:3117', trace: 'off', video: 'off', screenshot: 'off' },
});
