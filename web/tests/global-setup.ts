import { chromium, type FullConfig } from '@playwright/test'
import {
  E2E_AUTH_DIR,
  E2E_BASE_URL,
  E2E_BOOTSTRAP_STORAGE_STATE_PATH,
  TEST_USER,
  assertRecipeGenieAppShell,
  dismissOnboardingModal,
  ensureDirectory,
  logE2EContext,
  signInToRecipeGenie,
  waitForRecipeGenieSurface,
} from './e2e-env'

async function globalSetup(config: FullConfig) {
  const configuredBaseUrl = config.projects[0]?.use?.baseURL
  const baseURL = typeof configuredBaseUrl === 'string' ? configuredBaseUrl : E2E_BASE_URL

  ensureDirectory(E2E_AUTH_DIR)
  logE2EContext('global-setup', {
    baseURL,
    workerIndex: 'n/a',
    storageStatePath: E2E_BOOTSTRAP_STORAGE_STATE_PATH,
  })

  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const initialState = await waitForRecipeGenieSurface(page, 45000)

    if (initialState === 'auth') {
      await signInToRecipeGenie(page, TEST_USER)
    }

    await assertRecipeGenieAppShell(page, 45000)
    await dismissOnboardingModal(page)
    await page.context().storageState({ path: E2E_BOOTSTRAP_STORAGE_STATE_PATH })
    console.log(`[playwright:global-setup] verified Recipe Genie at ${page.url()}`)
  } catch (error) {
    const pageTitle = await page.title().catch(() => '')
    throw new Error(
      `Playwright did not connect to Recipe Genie app shell. Expected ${baseURL}, received URL=${page.url()} title="${pageTitle}". ${String(error)}`
    )
  } finally {
    await browser.close()
  }
}

export default globalSetup
