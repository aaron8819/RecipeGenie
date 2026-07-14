import { defineConfig, devices } from '@playwright/test'
import { E2E_CONFIG } from './tests/e2e-env'

const coreCiGrep = /@core/
const extendedGrep = /@extended/
const smokeGrep = /@smoke/
const localUrl = new URL(E2E_CONFIG.baseURL)

console.log(`[playwright] target=${E2E_CONFIG.target} allowedOrigin=${E2E_CONFIG.allowedOrigin}`)

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: E2E_CONFIG.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'core-ci', grep: coreCiGrep, use: { ...devices['Desktop Chrome'] } },
    { name: 'extended-chromium', grep: extendedGrep, use: { ...devices['Desktop Chrome'] } },
    { name: 'smoke', grep: smokeGrep, use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
    { name: 'iPhone SE', use: { ...devices['iPhone SE'] } },
    { name: 'iPad', use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: E2E_CONFIG.target === 'local'
    ? {
        command: `npm run dev -- --hostname ${localUrl.hostname} --port ${localUrl.port}`,
        url: E2E_CONFIG.baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      }
    : undefined,
})
