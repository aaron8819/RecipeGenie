import { expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

export const E2E_HOST = '127.0.0.1'
export const E2E_PORT = 3107
export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`
export const E2E_AUTH_DIR = '.playwright/auth'
export const E2E_BOOTSTRAP_STORAGE_STATE_PATH = path.join(E2E_AUTH_DIR, 'bootstrap-user.json')

export const TEST_USER = {
  email: 'aabloch@microsoft.com',
  password: 'recipegenie123',
}

const AUTH_HEADING_SELECTOR = 'h1:has-text("Recipe Genie")'
const APP_SHELL_SELECTOR = 'header h1:has-text("Recipe Genie"), button[aria-label="Sign out"]'
const AUTH_FORM_SELECTOR = '#email, #password'

export function ensureDirectory(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function getWorkerStorageStatePath(workerIndex: number) {
  return path.join(E2E_AUTH_DIR, `user-worker-${workerIndex}.json`)
}

export function logE2EContext(label: string, details: {
  baseURL: string
  workerIndex: number | string
  storageStatePath: string
}) {
  console.log(`[playwright:${label}] server=${details.baseURL} port=${E2E_PORT} worker=${details.workerIndex} storageState=${details.storageStatePath}`)
}

export async function isRecipeGenieAppShellVisible(page: Page): Promise<boolean> {
  return page.locator(APP_SHELL_SELECTOR).first().isVisible().catch(() => false)
}

export async function isRecipeGenieAuthVisible(page: Page): Promise<boolean> {
  const headingVisible = await page.locator(AUTH_HEADING_SELECTOR).first().isVisible().catch(() => false)
  const authFieldVisible = await page.locator(AUTH_FORM_SELECTOR).first().isVisible().catch(() => false)
  return headingVisible && authFieldVisible
}

export async function waitForRecipeGenieSurface(page: Page, timeoutMs = 45000): Promise<'app' | 'auth'> {
  await page.waitForLoadState('domcontentloaded')

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isRecipeGenieAppShellVisible(page)) {
      return 'app'
    }

    if (await isRecipeGenieAuthVisible(page)) {
      return 'auth'
    }

    await page.waitForTimeout(250)
  }

  throw new Error(
    `Playwright did not connect to Recipe Genie app shell. URL=${page.url()} title="${await page.title().catch(() => '')}"`
  )
}

export async function assertRecipeGenieAppShell(page: Page, timeoutMs = 45000) {
  await expect(page.locator(APP_SHELL_SELECTOR).first()).toBeVisible({ timeout: timeoutMs })
}

export async function signInToRecipeGenie(page: Page, credentials = TEST_USER) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

  const emailInput = page.getByLabel('Email')
  const passwordInput = page.getByLabel('Password')
  await emailInput.waitFor({ state: 'visible', timeout: 15000 })
  await passwordInput.waitFor({ state: 'visible', timeout: 15000 })

  await emailInput.fill(credentials.email)
  await passwordInput.fill(credentials.password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
}

export async function dismissOnboardingModal(page: Page) {
  const onboardingModal = page.getByText('Welcome to Recipe Genie').first()
  if (await onboardingModal.isVisible().catch(() => false)) {
    const continueButton = page.getByRole('button', { name: /continue/i })
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click()
      await page.waitForTimeout(500)
    }

    const getStartedButton = page.getByRole('button', { name: /get started/i })
    if (await getStartedButton.isVisible().catch(() => false)) {
      await getStartedButton.click()
      await page.waitForTimeout(500)
    }

    await page.evaluate(() => {
      localStorage.setItem('recipe-genie-onboarding-seen', 'true')
    })
  }
}
