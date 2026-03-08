import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND || 'npm run dev'
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER
  ? process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1'
  : !process.env.CI

const smokeTestMatch = [
  '**/authentication.spec.ts',
  '**/recipes.spec.ts',
  '**/meal-planner.spec.ts',
  '**/shopping-mode-smoke.spec.ts',
  '**/smoke-critical-flow.spec.ts',
]

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
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
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

    /* Reuse authenticated state from global setup */
    storageState: 'playwright/.auth/user.json',

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
    /* Smoke suite: critical end-to-end flow on Chromium only */
    {
      name: 'smoke',
      testMatch: smokeTestMatch,
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
    reuseExistingServer,
    timeout: 120 * 1000,
  },
})
