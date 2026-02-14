import { chromium, type FullConfig } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const TEST_USER = {
  email: 'aabloch@microsoft.com',
  password: 'recipegenie123',
}

/**
 * Global setup that authenticates once and saves the storage state.
 * This state is reused across all tests, avoiding repeated logins.
 */
async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use
  const storageStatePath = 'playwright/.auth/user.json'

  // Ensure the auth directory exists
  const authDir = path.dirname(storageStatePath)
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }

  // Check if we already have a valid storage state
  if (fs.existsSync(storageStatePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'))
      // Check if state has cookies or origins (indicates it's been saved before)
      if (state.cookies?.length > 0 || state.origins?.length > 0) {
        console.log('📁 Found existing storage state, verifying...')

        // Verify it's still valid by trying to load the app
        const browser = await chromium.launch()
        const context = await browser.newContext({ storageState: storageStatePath })
        const page = await context.newPage()

        try {
          await page.goto(baseURL || 'http://localhost:3000', { timeout: 30000 })
          await page.waitForTimeout(2000)

          // Check if authenticated
          const isAuth = await page.locator('header').first().isVisible().catch(() => false)
          const isAuthPage = await page.locator('#email').isVisible().catch(() => false)

          if (isAuth && !isAuthPage) {
            console.log('✅ Existing storage state is valid')
            await browser.close()
            return
          }

          console.log('⚠️ Existing storage state expired, re-authenticating...')
        } catch {
          console.log('⚠️ Could not verify storage state, re-authenticating...')
        }

        await browser.close()
      }
    } catch {
      console.log('⚠️ Could not parse storage state, re-authenticating...')
    }
  }

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    console.log('🔐 Global setup: Starting authentication...')
    console.log(`📍 Base URL: ${baseURL || 'http://localhost:3000'}`)

    // Navigate to the app with longer timeout
    await page.goto(baseURL || 'http://localhost:3000', { timeout: 60000 })

    // Wait for the page to be fully loaded
    await page.waitForLoadState('domcontentloaded')
    console.log('📄 Page loaded, current URL:', page.url())

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      console.log('⚠️ Network idle timeout - continuing anyway')
    })

    // Check if we're already authenticated (redirected to main app)
    // Use a more flexible selector that works on both desktop and mobile
    const isAlreadyAuthenticated = await page.locator('header, nav').first().isVisible().catch(() => false)
    const hasAuthForm = await page.locator('#email').isVisible().catch(() => false)

    console.log(`🔍 Auth check: header/nav visible=${isAlreadyAuthenticated}, auth form visible=${hasAuthForm}`)

    if (isAlreadyAuthenticated && !hasAuthForm) {
      console.log('✅ Already authenticated, saving state')
      await context.storageState({ path: storageStatePath })
      await browser.close()
      return
    }

    // Wait for auth form to appear
    console.log('📝 Waiting for auth form...')
    await page.waitForSelector('form', { state: 'visible', timeout: 30000 })

    // Use ID selector which is more reliable
    const emailInput = page.locator('#email')
    const passwordInput = page.locator('#password')

    // Wait for inputs to be visible and enabled
    await emailInput.waitFor({ state: 'visible', timeout: 10000 })
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 })

    // Fill in sign-in form
    console.log(`📝 Filling credentials for ${TEST_USER.email}...`)
    await emailInput.fill(TEST_USER.email)
    await passwordInput.fill(TEST_USER.password)

    // Click sign in button
    const signInButton = page.getByRole('button', { name: /sign in/i })
    await signInButton.waitFor({ state: 'visible', timeout: 5000 })
    await signInButton.click()

    // Wait for successful authentication (main app loads)
    console.log('⏳ Waiting for authentication to complete...')

    // Wait for either header (desktop) or nav (mobile) to appear
    await page.waitForSelector('header, nav.fixed', { state: 'visible', timeout: 30000 })

    // Make sure auth form is gone
    await page.waitForSelector('#email', { state: 'hidden', timeout: 10000 }).catch(() => {
      console.log('⚠️ Auth form still visible after sign in')
    })

    // Give it a moment for auth state to settle
    await page.waitForTimeout(2000)

    // Verify we're authenticated
    const finalAuthCheck = await page.locator('#email').isVisible().catch(() => false)
    if (finalAuthCheck) {
      throw new Error('Still on auth page after sign in - credentials may be invalid')
    }

    // Handle first-run onboarding modal if it appears
    console.log('🔍 Checking for onboarding modal...')
    const onboardingModal = page.getByText('Welcome to Recipe Genie').first()
    if (await onboardingModal.isVisible().catch(() => false)) {
      console.log('📋 Onboarding modal detected, completing it...')

      // Click Continue on first step
      const continueButton = page.getByRole('button', { name: /continue/i })
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click()
        await page.waitForTimeout(500)
      }

      // Click Get Started on second step
      const getStartedButton = page.getByRole('button', { name: /get started/i })
      if (await getStartedButton.isVisible().catch(() => false)) {
        await getStartedButton.click()
        await page.waitForTimeout(500)
      }

      console.log('✅ Onboarding modal completed')
    }

    // Set localStorage to prevent onboarding from showing again
    await page.evaluate(() => {
      localStorage.setItem('recipe-genie-onboarding-seen', 'true')
    })

    // Save the storage state (cookies, localStorage, etc.)
    await context.storageState({ path: storageStatePath })

    console.log('✅ Global setup: Authenticated successfully')
    console.log(`📁 Storage state saved to ${storageStatePath}`)
  } catch (error) {
    console.error('❌ Global setup: Authentication failed')
    console.error(error)

    // Take a screenshot for debugging
    const screenshotPath = 'test-results/auth-failure.png'
    const screenshotDir = path.dirname(screenshotPath)
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true })
    }
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`📸 Screenshot saved to ${screenshotPath}`)

    // Log current page state
    console.log('📍 Current URL:', page.url())
    console.log('📄 Page title:', await page.title())

    // Log page content for debugging
    const bodyText = await page.locator('body').textContent().catch(() => '')
    console.log('📄 Page text (first 500 chars):', bodyText?.slice(0, 500))

    throw error
  } finally {
    await browser.close()
  }
}

export default globalSetup
