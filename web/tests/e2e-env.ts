import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type Page } from '@playwright/test'
import { assertAllowedOrigin, getE2EConfig, type E2EConfig } from './e2e-config'

export { assertAllowedOrigin } from './e2e-config'

export const E2E_CONFIG = getE2EConfig()
export const E2E_AUTH_DIR = path.resolve(process.cwd(), '.playwright', 'auth')
export const TEST_USER = {
  email: E2E_CONFIG.email,
  password: E2E_CONFIG.password,
}

export function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
}

export function createStorageStatePaths(testId: string) {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(-80)
  const stem = `${safeId}-${randomUUID()}`
  return {
    statePath: path.join(E2E_AUTH_DIR, `${stem}.json`),
    metadataPath: path.join(E2E_AUTH_DIR, `${stem}.meta.json`),
  }
}

export function removeRuntimeAuthFiles(...files: string[]) {
  for (const file of files) fs.rmSync(file, { force: true })
}

export function writeStorageMetadata(metadataPath: string, config: E2EConfig) {
  const identityHash = createHash('sha256')
    .update(`${config.allowedOrigin}\0${config.email.trim().toLowerCase()}`)
    .digest('hex')

  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify({ origin: config.allowedOrigin, identityHash, createdAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

export function assertStorageStateContainsNoCredentials(statePath: string, config: E2EConfig) {
  const state = fs.readFileSync(statePath, 'utf8')
  if (
    state.toLowerCase().includes(config.email.trim().toLowerCase()) ||
    state.includes(config.password)
  ) {
    throw new Error('Generated Playwright storage state contains forbidden plaintext credential data')
  }
}

export async function isRecipeGenieAppShellVisible(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: /sign out/i }).isVisible().catch(() => false)
}

export async function isRecipeGenieAuthVisible(page: Page): Promise<boolean> {
  const emailVisible = await page.getByLabel('Email').isVisible().catch(() => false)
  const passwordVisible = await page.getByLabel('Password').isVisible().catch(() => false)
  return emailVisible && passwordVisible
}

export async function waitForRecipeGenieSurface(page: Page, timeout = 45000): Promise<'app' | 'auth'> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    assertAllowedOrigin(page.url(), E2E_CONFIG, 'surface wait')
    if (await isRecipeGenieAppShellVisible(page)) return 'app'
    if (await isRecipeGenieAuthVisible(page)) return 'auth'
    await page.waitForTimeout(250)
  }
  throw new Error('Recipe Genie did not render an authenticated shell or sign-in form in time')
}

export async function assertRecipeGenieAppShell(page: Page, timeout = 45000) {
  const signOutButton = page.getByRole('button', { name: /sign out/i })
  const started = Date.now()

  while (Date.now() - started < timeout) {
    assertAllowedOrigin(page.url(), E2E_CONFIG, 'app shell')
    if (await signOutButton.isVisible().catch(() => false)) return
    await page.waitForTimeout(250)
  }

  throw new Error('Recipe Genie authenticated shell did not render on the approved origin in time')
}

export async function signInToRecipeGenie(page: Page, config: E2EConfig = E2E_CONFIG) {
  const email = page.getByLabel('Email')
  const password = page.getByLabel('Password')
  let stage = 'navigation'

  try {
    await page.goto(new URL('/', config.baseURL).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    stage = 'before username entry'
    assertAllowedOrigin(page.url(), config, stage)
    await email.fill(config.email)

    stage = 'before password entry'
    assertAllowedOrigin(page.url(), config, stage)
    await password.fill(config.password)

    stage = 'before sign-in submission'
    assertAllowedOrigin(page.url(), config, stage)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    stage = 'after sign-in submission'
    await assertRecipeGenieAppShell(page, 45000)
  } catch {
    await password.fill('').catch(() => undefined)
    await email.fill('').catch(() => undefined)
    throw new Error(`Recipe Genie authentication failed during ${stage}; credential values were redacted`)
  }
}

export async function dismissOnboardingModal(page: Page) {
  const onboardingDialog = page.getByRole('dialog').filter({
    hasText: 'Welcome to Recipe Genie',
  }).first()
  await onboardingDialog.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
  if (await onboardingDialog.isVisible().catch(() => false)) {
    const continueButton = onboardingDialog.getByRole('button', { name: /continue/i })
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click()
    }

    const getStartedButton = onboardingDialog.getByRole('button', { name: /get started/i })
    await getStartedButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    if (await getStartedButton.isVisible().catch(() => false)) {
      await getStartedButton.click()
    }
    await onboardingDialog.waitFor({ state: 'hidden', timeout: 5000 })

    await page.evaluate(() => {
      localStorage.setItem('recipe-genie-onboarding-seen', 'true')
    })
  }
}
