import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL, E2E_HOST, E2E_PORT } from './tests/e2e-env'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || E2E_BASE_URL
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ||
  `npm run dev -- --hostname ${E2E_HOST} --port ${E2E_PORT}`

const coreCiGrep = /@core/
const extendedGrep = /@extended/
const smokeGrep = /@smoke/

/**
 * Recipe Genie Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Authenticated tests share one remote test account and must not revoke or race sibling sessions. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  /* Global setup - authenticates once before all tests */
  globalSetup: require.resolve('./tests/global-setup'),
  /* Default test timeout - 60 seconds */
  timeout: 60000,
  /* Expect timeout - 10 seconds */
  expect: {
    timeout: 10000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'on-first-retry',

    /* Action timeout - 15 seconds */
    actionTimeout: 15000,

    /* Navigation timeout - 30 seconds */
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  projects: [
    /* Core CI suite: lean Chromium-only baseline */
    {
      name: 'core-ci',
      grep: coreCiGrep,
      use: { ...devices['Desktop Chrome'] },
    },

    /* Extended suite: mobile, accessibility, and responsive contracts on Chromium */
    {
      name: 'extended-chromium',
      grep: extendedGrep,
      use: { ...devices['Desktop Chrome'] },
    },

    /* Smoke subset: highest-signal core path checks on Chromium only */
    {
      name: 'smoke',
      grep: smokeGrep,
      use: { ...devices['Desktop Chrome'] },
    },

    /* Desktop browsers */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Mobile viewports */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    {
      name: 'iPhone SE',
      use: { ...devices['iPhone SE'] },
    },

    /* Tablet viewports */
    {
      name: 'iPad',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
