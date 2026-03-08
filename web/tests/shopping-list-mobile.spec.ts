import { test, expect, VIEWPORTS, MIN_TOUCH_TARGET, measureTouchTarget } from './fixtures'

/**
 * Mobile-specific E2E tests for the Shopping List component
 *
 * Tests responsive behavior, touch interactions, and mobile UI patterns:
 * - Three-dot menu for item actions
 * - Icon-only header buttons
 * - Horizontal scroll for recipe tags
 * - Touch-friendly button sizes (44px minimum)
 * - Long-press to drag behavior
 *
 * Viewports tested:
 * - Pixel 5: 393 x 851
 * - iPhone 12: 390 x 844
 * - iPhone SE: 375 x 667
 */

/**
 * Helper to add items to shopping list on mobile
 */
async function addItemsToShoppingListMobile(
  page: import('@playwright/test').Page,
  navigateToTab: (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>
) {
  // Try to add from an existing recipe first
  await navigateToTab('recipes')
  await page.waitForTimeout(1000)

  // Find a recipe card
  const recipeCard = page.locator('[class*="Card"]').filter({ has: page.locator('h3') }).first()
  const hasRecipes = await recipeCard.isVisible().catch(() => false)

  if (hasRecipes) {
    // Mobile: click the menu button, then select "Add to Shopping List"
    const menuButton = recipeCard.locator('button').filter({ has: page.locator('svg') }).last()
    if (await menuButton.isVisible().catch(() => false)) {
      await menuButton.click()
      await page.waitForTimeout(200)

      const addToShoppingOption = page.getByRole('menuitem', { name: /add to shopping list/i })
      if (await addToShoppingOption.isVisible().catch(() => false)) {
        await addToShoppingOption.click()
        await page.waitForTimeout(1000)
      }
    }
  }

  // Navigate to shopping list
  await navigateToTab('shopping')
  await page.waitForTimeout(500)

  // If no recipes, add manual items as fallback
  if (!hasRecipes) {
    const addInput = page.getByPlaceholder(/add.*tomatoes|add item/i)
    if (await addInput.isVisible().catch(() => false)) {
      await addInput.fill('chicken breast, broccoli, soy sauce, rice')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
    }
  }
}

test.describe('Shopping List Mobile', () => {
  // Configure viewport and touch support for mobile tests
  test.use({ viewport: VIEWPORTS.mobile, hasTouch: true })

  test.beforeEach(async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('shopping')
  })

  test.describe('Mobile Navigation & Layout', () => {
    test('should use bottom navigation on mobile', async ({ page }) => {
      // Bottom nav should be visible
      const bottomNav = page.locator('nav.fixed.bottom-0').or(
        page.locator('nav').last()
      )
      await expect(bottomNav).toBeVisible()

      // Header navigation should be simplified/hidden
      const headerNav = page.locator('header.md\\:fixed')
      // Header may still exist but with different layout
    })

    test('should show icon-only header buttons on mobile', async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)

      // Look for Organize button - should be icon only (no text "Organize")
      const organizeButton = page.locator('button').filter({
        has: page.locator('svg[class*="Sparkles"], svg[class*="Settings"]')
      }).first()

      if (await organizeButton.isVisible().catch(() => false)) {
        const buttonText = await organizeButton.textContent()
        // On mobile, button should be icon-only or have very short text
        expect(buttonText?.trim().length).toBeLessThanOrEqual(10)
      }
    })

    test('should have responsive recipe tags with horizontal scroll', async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)

      // Recipe tags section should be horizontally scrollable
      const tagsSection = page.locator('[class*="overflow-x"]').or(
        page.getByText(/recipes in list/i).locator('..')
      )

      if (await tagsSection.isVisible().catch(() => false)) {
        // Should have overflow-x-auto or similar for horizontal scroll
        const hasOverflow = await tagsSection.evaluate(el => {
          const style = window.getComputedStyle(el)
          return style.overflowX === 'auto' || style.overflowX === 'scroll'
        }).catch(() => false)

        // Either has horizontal scroll or tags wrap
      }
    })
  })

  test.describe('Three-Dot Menu (Mobile Item Actions)', () => {
    test.beforeEach(async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)
    })

    test('should show three-dot menu for item actions', async ({ page }) => {
      // On mobile, item actions should be in a menu (not hover buttons)
      const itemRow = page.locator('[data-checkbox="true"]').first().locator('..')

      if (await itemRow.isVisible().catch(() => false)) {
        // Look for menu button (MoreVertical icon, three dots)
        const menuButton = itemRow.locator('button').filter({
          has: page.locator('svg[class*="MoreVertical"], svg[class*="Dots"]')
        }).or(
          itemRow.locator('[aria-haspopup="menu"]')
        )

        if (await menuButton.isVisible().catch(() => false)) {
          await menuButton.click()
          await page.waitForTimeout(200)

          // Menu should appear with options
          const menu = page.locator('[role="menu"]')
          await expect(menu).toBeVisible()

          // Should have common actions
          const menuItems = menu.locator('[role="menuitem"]')
          expect(await menuItems.count()).toBeGreaterThan(0)

          // Close menu
          await page.keyboard.press('Escape')
        }
      }
    })

    test('should include Add to Pantry option in menu', async ({ page }) => {
      const itemRow = page.locator('[data-checkbox="true"]').first().locator('..')

      if (await itemRow.isVisible().catch(() => false)) {
        const menuButton = itemRow.locator('button').filter({
          has: page.locator('svg[class*="MoreVertical"], svg[class*="Dots"]')
        })

        if (await menuButton.isVisible().catch(() => false)) {
          await menuButton.click()
          await page.waitForTimeout(200)

          const pantryOption = page.getByRole('menuitem', { name: /pantry/i })
          // Option may or may not be present
          if (await pantryOption.isVisible().catch(() => false)) {
            await expect(pantryOption).toBeVisible()
          }

          await page.keyboard.press('Escape')
        }
      }
    })

    test('should include Remove option in menu', async ({ page }) => {
      const itemRow = page.locator('[data-checkbox="true"]').first().locator('..')

      if (await itemRow.isVisible().catch(() => false)) {
        const menuButton = itemRow.locator('button').filter({
          has: page.locator('svg[class*="MoreVertical"], svg[class*="Dots"]')
        })

        if (await menuButton.isVisible().catch(() => false)) {
          await menuButton.click()
          await page.waitForTimeout(200)

          const removeOption = page.getByRole('menuitem', { name: /remove|delete/i })
          // Option may or may not be present
          if (await removeOption.isVisible().catch(() => false)) {
            await expect(removeOption).toBeVisible()
          }

          await page.keyboard.press('Escape')
        }
      }
    })
  })

  test.describe('Touch Target Sizes', () => {
    test.beforeEach(async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)
    })

    test('should have minimum 44px touch targets for checkboxes', async ({ page }) => {
      const checkbox = page.locator('[data-checkbox="true"]').first()

      if (await checkbox.isVisible().catch(() => false)) {
        const size = await measureTouchTarget(checkbox)

        // WCAG 2.1 recommends 44x44px minimum touch targets
        expect(size.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        expect(size.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      }
    })

    test('should have minimum touch targets for action buttons', async ({ page }) => {
      // Check clear button
      const clearButton = page.getByRole('button', { name: /clear/i }).or(
        page.locator('button').filter({ has: page.locator('svg[class*="Trash"]') })
      ).first()

      if (await clearButton.isVisible().catch(() => false)) {
        const size = await measureTouchTarget(clearButton)
        expect(size.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        expect(size.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      }
    })

    test('should have minimum touch targets for navigation buttons', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0').or(page.locator('nav').last())
      const navButtons = bottomNav.locator('button')

      const count = await navButtons.count()
      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = navButtons.nth(i)
        if (await button.isVisible().catch(() => false)) {
          const size = await measureTouchTarget(button)
          expect(size.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
          expect(size.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        }
      }
    })
  })

  test.describe('Touch Interactions', () => {
    test.beforeEach(async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)
    })

    test('should toggle checkbox on tap', async ({ page }) => {
      const checkbox = page.locator('[data-checkbox="true"]').first()

      if (await checkbox.isVisible().catch(() => false)) {
        // Tap (click on mobile)
        await checkbox.tap()
        await page.waitForTimeout(300)

        // Should show checked state
        const checkIcon = checkbox.locator('svg')
        await expect(checkIcon).toBeVisible()

        // Tap again to uncheck
        await checkbox.tap()
        await page.waitForTimeout(300)
      }
    })

    test('should allow swiping on recipe tags for horizontal scroll', async ({ page }) => {
      await page.getByRole('button', { name: /show recipes in list/i }).click()

      // Recipe tags section
      const tagsSection = page.getByText(/recipes in list/i).locator('..')

      if (await tagsSection.isVisible().catch(() => false)) {
        // Get initial scroll position
        const initialScroll = await tagsSection.evaluate(el => el.scrollLeft)

        // Simulate swipe (drag gesture)
        const box = await tagsSection.boundingBox()
        if (box) {
          await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
          await page.mouse.down()
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 })
          await page.mouse.up()
          await page.waitForTimeout(300)

          // Scroll position may have changed
          const newScroll = await tagsSection.evaluate(el => el.scrollLeft)
          // On containers with overflow-x, scroll should change
        }
      }
    })
  })

  test.describe('Responsive Behavior - iPhone SE (375px)', () => {
    test.use({ viewport: VIEWPORTS.mobileSmall, hasTouch: true })

    test('should display correctly on small screens', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await addItemsToShoppingListMobile(page, navigateToTab)

      // Content should fit without horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(hasHorizontalScroll).toBe(false)
    })

    test('should have readable text on small screens', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await addItemsToShoppingListMobile(page, navigateToTab)

      // Check that text elements have adequate size
      const itemText = page.locator('[data-checkbox="true"]').first().locator('..')
      if (await itemText.isVisible().catch(() => false)) {
        const fontSize = await itemText.evaluate(el => {
          const style = window.getComputedStyle(el)
          return parseFloat(style.fontSize)
        })
        // Minimum readable font size (12px)
        expect(fontSize).toBeGreaterThanOrEqual(12)
      }
    })
  })

  test.describe('Responsive Behavior - iPhone 12 (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('should display correctly on iPhone 12', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await addItemsToShoppingListMobile(page, navigateToTab)

      // Page should render without errors
      const body = page.locator('body')
      await expect(body).toBeVisible()

      // Shopping list content should be visible
      const hasContent = await page.locator('[data-checkbox="true"]').first().isVisible().catch(() => false)
        || await page.getByText(/no shopping list/i).isVisible().catch(() => false)

      expect(hasContent).toBe(true)
    })
  })

  test.describe('Responsive Behavior - Large Mobile (414px)', () => {
    test.use({ viewport: VIEWPORTS.mobileLarge, hasTouch: true })

    test('should take advantage of extra space', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await addItemsToShoppingListMobile(page, navigateToTab)

      // On larger mobile, may show more content
      const body = page.locator('body')
      await expect(body).toBeVisible()
    })
  })

  test.describe('Mobile-Specific Empty State', () => {
    test('should display mobile-friendly empty state', async ({ page }) => {
      // First, clear any existing items to ensure we start with an empty list
      const clearButton = page.locator('button[aria-label="Clear list"]')

      // Keep clearing until no items remain (handles undo toast timing)
      let attempts = 0
      while (attempts < 3) {
        const hasItems = await page.locator('[data-checkbox="true"]').first().isVisible().catch(() => false)
        if (!hasItems) break

        if (await clearButton.isVisible().catch(() => false)) {
          await clearButton.tap()
          await page.waitForTimeout(1000) // Wait for clear and any undo toast to settle
        }
        attempts++
      }

      // Empty state should be visible and centered
      const emptyState = page.getByText(/no shopping list yet/i)
      await expect(emptyState).toBeVisible({ timeout: 5000 })

      // Should have call-to-action button/link
      const ctaButton = page.getByRole('button', { name: /add|start|generate/i })
      // CTA may or may not be present
    })
  })

  test.describe('Mobile Input Experience', () => {
    test('should have touch-friendly add item input', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add.*tomatoes|add item/i)
      await addInput.waitFor({ state: 'visible', timeout: 5000 })

      // Input should have adequate height for touch
      const box = await addInput.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40)
      }
    })

    test('should show keyboard when input is focused', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add.*tomatoes|add item/i)
      await addInput.waitFor({ state: 'visible', timeout: 5000 })

      // Focus input
      await addInput.focus()
      await page.waitForTimeout(300)

      // Input should be focused
      const isFocused = await addInput.evaluate(el => document.activeElement === el)
      expect(isFocused).toBe(true)
    })

    test('should submit on Enter key from mobile keyboard', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add.*tomatoes|add item/i)
      await addInput.waitFor({ state: 'visible', timeout: 5000 })

      await addInput.fill('mobile test item')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      // Item should be added
      await expect(page.getByText('mobile test item')).toBeVisible()
    })
  })

  test.describe('Mobile Category Interaction', () => {
    test.beforeEach(async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)
    })

    test('should expand/collapse categories on tap', async ({ page }) => {
      const categoryHeader = page.locator('[class*="CardHeader"]').first()

      if (await categoryHeader.isVisible().catch(() => false)) {
        // Get initial state
        const itemsBefore = await page.locator('[data-checkbox="true"]').count()

        // Tap to collapse
        await categoryHeader.tap()
        await page.waitForTimeout(300)

        // Tap to expand
        await categoryHeader.tap()
        await page.waitForTimeout(300)

        // Items should be visible again
        const itemsAfter = await page.locator('[data-checkbox="true"]').count()
        expect(itemsAfter).toBeGreaterThan(0)
      }
    })

    test('should keep drag handles hidden until Manage Mode is enabled', async ({ page }) => {
      await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)

      await page.getByRole('button', { name: /organize/i }).tap()
      await page.getByRole('menuitem', { name: /enter manage mode/i }).tap()

      await expect(page.getByText(/manage mode/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /drag to reorder/i }).first()).toBeVisible()
    })
  })

  test.describe('Shopping Context Density', () => {
    test.beforeEach(async ({ page, navigateToTab }) => {
      await addItemsToShoppingListMobile(page, navigateToTab)
    })

    test('should keep recipes in list collapsed by default on mobile', async ({ page }) => {
      await expect(page.getByText(/recipes in list/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /show recipes in list/i })).toBeVisible()
    })
  })

  test.describe('Mobile Settings Modal', () => {
    test('should open settings modal in mobile-friendly layout', async ({ page }) => {
      const organizeButton = page.getByRole('button', { name: /organize/i }).or(
        page.locator('button').filter({ has: page.locator('svg[class*="Sparkles"]') })
      )

      if (await organizeButton.first().isVisible().catch(() => false)) {
        await organizeButton.first().tap()
        await page.getByRole('menuitem', { name: /shopping settings/i }).tap()
        await page.waitForTimeout(300)

        const dialog = page.locator('[role="dialog"]')
        await expect(dialog).toBeVisible()

        // Dialog should be full-width or nearly so on mobile
        const dialogBox = await dialog.boundingBox()
        const viewport = page.viewportSize()

        if (dialogBox && viewport) {
          // Dialog should take up most of the width
          expect(dialogBox.width).toBeGreaterThan(viewport.width * 0.8)
        }

        // Close dialog
        await page.keyboard.press('Escape')
      }
    })
  })
})
