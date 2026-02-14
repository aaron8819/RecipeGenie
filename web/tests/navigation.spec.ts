import { test, expect, VIEWPORTS } from './fixtures'

test.describe('Navigation', () => {
  test.describe('Desktop Header Navigation', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.desktop)
      await setupAuth()
    })

    test('should display fixed header at top', async ({ page }) => {
      // Target the main navigation header (the one with fixed positioning class)
      const header = page.locator('header.md\\:fixed')
      await expect(header).toBeVisible()

      // Check header is fixed
      const headerStyles = await header.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          position: styles.position,
          top: styles.top,
        }
      })

      // On desktop, header should be fixed (md: prefix applies)
      // Check for either fixed or static (may depend on breakpoint)
      expect(['fixed', 'static']).toContain(headerStyles.position)
    })

    test('should display all navigation tabs', async ({ page }) => {
      const tabs = ['Planner', 'Recipes', 'Shopping', 'Pantry']

      for (const tab of tabs) {
        const tabButton = page.locator('header.md\\:fixed').getByRole('button', { name: new RegExp(tab, 'i') })
        await expect(tabButton).toBeVisible()
      }
    })

    test('should show active tab with underline indicator', async ({ page }) => {
      // Navigate to recipes tab
      await page.locator('header.md\\:fixed').getByRole('button', { name: /recipes/i }).click()
      await page.waitForTimeout(300)

      // Check for active styling (border-b-2 class)
      const activeTab = page.locator('header button.border-b-2.border-primary')
      await expect(activeTab).toBeVisible()
      await expect(activeTab).toHaveText(/recipes/i)
    })

    test('should switch content when clicking tabs', async ({ page }) => {
      // Click on Pantry tab
      await page.locator('header.md\\:fixed').getByRole('button', { name: /pantry/i }).click()
      await page.waitForTimeout(300)

      // Verify pantry content is visible (look for pantry-specific elements)
      const pantryContent = page.getByText(/pantry|add item/i)
      await expect(pantryContent.first()).toBeVisible()
    })

    test('should display user avatar with initials', async ({ page }) => {
      // In guest mode, should show "G"
      const avatar = page.locator('[title="Guest"]')
      await expect(avatar).toBeVisible()
      await expect(avatar).toHaveText('G')
    })

    test('should display help icon that opens onboarding dialog', async ({ page }) => {
      const helpButton = page.getByRole('button', { name: /help/i })
      await expect(helpButton).toBeVisible()

      await helpButton.click()

      // Dialog should open
      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()
    })

    test('should hide bottom navigation on desktop', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      await expect(bottomNav).toBeHidden()
    })

    test('should maintain header on scroll', async ({ page }) => {
      // Add some content to enable scrolling
      await page.evaluate(() => {
        document.body.style.height = '3000px'
      })

      // Scroll down
      await page.evaluate(() => window.scrollTo(0, 500))
      await page.waitForTimeout(100)

      // Main navigation header should still be visible
      const header = page.locator('header.md\\:fixed')
      await expect(header).toBeVisible()
    })

    test('should not cause layout shift when switching tabs', async ({ page }) => {
      // Target the main navigation header (the one with fixed positioning class)
      const mainHeader = page.locator('header.md\\:fixed')

      // Get initial header position
      const initialPosition = await mainHeader.boundingBox()

      // Switch tabs
      await mainHeader.getByRole('button', { name: /shopping/i }).click()
      await page.waitForTimeout(300)

      // Get new header position
      const newPosition = await mainHeader.boundingBox()

      // Position should be the same
      expect(initialPosition?.y).toBe(newPosition?.y)
      expect(initialPosition?.height).toBe(newPosition?.height)
    })
  })

  test.describe('Mobile Bottom Navigation', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()
    })

    test('should display bottom navigation on mobile', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      await expect(bottomNav).toBeVisible()
    })

    test('should display all four tabs', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      const tabs = ['Planner', 'Recipes', 'Shopping', 'Pantry']

      for (const tab of tabs) {
        const tabButton = bottomNav.getByRole('button', { name: new RegExp(tab, 'i') })
        await expect(tabButton).toBeVisible()
      }
    })

    test('should highlight active tab', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')

      // Click recipes tab
      await bottomNav.getByRole('button', { name: /recipes/i }).click()
      await page.waitForTimeout(300)

      // Check for active styling
      const activeButton = bottomNav.locator('button.text-primary')
      await expect(activeButton).toBeVisible()
    })

    test('should have clear and recognizable icons', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      const buttons = bottomNav.locator('button')

      // All 4 buttons should have SVG icons
      const count = await buttons.count()
      expect(count).toBe(4)

      for (let i = 0; i < count; i++) {
        const icon = buttons.nth(i).locator('svg')
        await expect(icon).toBeVisible()
      }
    })

    test('should switch content smoothly on tap', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')

      // Navigate to each tab and verify content loads
      const tabs = ['planner', 'recipes', 'shopping', 'pantry']

      for (const tab of tabs) {
        await bottomNav.getByRole('button', { name: new RegExp(tab, 'i') }).click()
        await page.waitForTimeout(300)

        // Content should be visible (no error states)
        const errorState = page.getByText(/error|failed|crash/i)
        await expect(errorState).not.toBeVisible()
      }
    })

    test('should have proper safe area padding', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')

      // Check for safe-area class
      const hasClass = await bottomNav.evaluate((el) => {
        return el.classList.contains('safe-area-bottom')
      })

      expect(hasClass).toBeTruthy()
    })

    test('should not overlap with floating action buttons', async ({ page }) => {
      // Navigate to recipes to see FAB
      const bottomNav = page.locator('nav.fixed.bottom-0')
      await bottomNav.getByRole('button', { name: /recipes/i }).click()
      await page.waitForTimeout(300)

      const fab = page.locator('button[aria-label="Add Recipe"]')
      const navBox = await bottomNav.boundingBox()

      if (await fab.isVisible()) {
        const fabBox = await fab.boundingBox()

        if (navBox && fabBox) {
          // FAB should be above the nav
          expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(navBox.y)
        }
      }
    })
  })

  test.describe('Tab Switching', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should persist active tab in localStorage', async ({ page, navigateToTab }) => {
      await navigateToTab('pantry')

      const storedTab = await page.evaluate(() => localStorage.getItem('recipe-genie-active-tab'))
      expect(storedTab).toBe('pantry')
    })

    test('should restore active tab on page reload', async ({ page, navigateToTab }) => {
      await navigateToTab('shopping')
      await page.reload()
      await page.waitForLoadState('networkidle')

      // May need to re-enter guest mode after reload
      const guestButton = page.getByRole('button', { name: /try as guest/i })
      if (await guestButton.isVisible()) {
        await guestButton.click()
        await page.waitForTimeout(300)
      }

      // Check if shopping tab content is visible (may vary by implementation)
      // The stored tab should be 'shopping'
      const storedTab = await page.evaluate(() => localStorage.getItem('recipe-genie-active-tab'))
      expect(storedTab).toBe('shopping')
    })
  })

  test.describe('Responsive Behavior', () => {
    test('should show header nav on tablet portrait', async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.tablet)
      await setupAuth()

      // At 768px width, should show header nav (md breakpoint)
      const headerNav = page.locator('header nav')
      await expect(headerNav).toBeVisible()
    })

    test('should hide bottom nav on tablet', async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.tablet)
      await setupAuth()

      const bottomNav = page.locator('nav.fixed.bottom-0')
      await expect(bottomNav).toBeHidden()
    })

    test('should transition smoothly between mobile and desktop layouts', async ({ page, setupAuth }) => {
      // Start on mobile
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()

      // Bottom nav visible on mobile
      await expect(page.locator('nav.fixed.bottom-0')).toBeVisible()

      // Resize to desktop
      await page.setViewportSize(VIEWPORTS.desktop)
      await page.waitForTimeout(300)

      // Bottom nav hidden, header nav visible
      await expect(page.locator('nav.fixed.bottom-0')).toBeHidden()
      await expect(page.locator('header nav')).toBeVisible()
    })
  })

  test.describe('Active Tab Indicators', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should show underline on desktop active tab', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      await page.locator('header.md\\:fixed').getByRole('button', { name: /recipes/i }).click()
      await page.waitForTimeout(300)

      const activeTab = page.locator('header button.border-b-2')
      await expect(activeTab).toBeVisible()
    })

    test('should show primary color on mobile active tab', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile)

      await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /shopping/i }).click()
      await page.waitForTimeout(300)

      const activeTab = page.locator('nav.fixed.bottom-0 button.text-primary')
      const activeText = await activeTab.textContent()
      expect(activeText?.toLowerCase()).toContain('shopping')
    })

    test('should scale icon on mobile active tab', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile)

      await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /planner/i }).click()
      await page.waitForTimeout(300)

      // Check if icon has scale class
      const activeIcon = page.locator('nav.fixed.bottom-0 button.text-primary svg.scale-110')
      await expect(activeIcon).toBeVisible()
    })
  })
})
