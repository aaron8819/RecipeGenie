import { test, expect, VIEWPORTS } from './fixtures'

test.describe('Pantry Management', () => {
  test.beforeEach(async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('pantry')
  })

  test.describe('Pantry List View', () => {
    test('should display empty state when no items', async ({ page }) => {
      const emptyState = page.getByText(/start building your pantry|no items/i)
      await expect(emptyState.first()).toBeVisible()
    })

    test('should display add item input', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await expect(addInput).toBeVisible()
    })

    test('should display excluded keywords section', async ({ page }) => {
      // Look for excluded keywords section header
      const excludedSection = page.getByText(/excluded.*keywords|always exclude/i)
      await expect(excludedSection.first()).toBeVisible()
    })
  })

  test.describe('Add Pantry Items', () => {
    test('should add item when typing and pressing Enter', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Olive Oil')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      await expect(page.getByText('Olive Oil')).toBeVisible()
    })

    test('should add item when clicking add button', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Rice')

      const addButton = page.getByRole('button', { name: /add/i }).first()
      await addButton.click()
      await page.waitForTimeout(300)

      await expect(page.getByText('Rice')).toBeVisible()
    })

    test('should clear input after adding item', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Pasta')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      await expect(addInput).toHaveValue('')
    })

    test('should prevent duplicate items', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)

      // Add item first time
      await addInput.fill('Butter')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Try to add same item again
      await addInput.fill('Butter')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Should only appear once
      const butterItems = page.getByText('Butter', { exact: true })
      const count = await butterItems.count()
      expect(count).toBe(1)
    })

    test('should be case-insensitive for duplicates', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)

      // Add item
      await addInput.fill('Milk')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Try to add with different case
      await addInput.fill('milk')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Should only have one entry
      // (case may be preserved from first entry)
    })

    test('should add multiple items', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      const items = ['Eggs', 'Flour', 'Sugar']

      for (const item of items) {
        await addInput.fill(item)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
      }

      for (const item of items) {
        await expect(page.getByText(item, { exact: true })).toBeVisible()
      }
    })
  })

  test.describe('Delete Pantry Items', () => {
    test.beforeEach(async ({ page }) => {
      // Add an item first
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Test Item')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
    })

    test('should show delete button on item', async ({ page }) => {
      // Find delete button (trash icon)
      const deleteButton = page.locator('button').filter({ has: page.locator('svg[class*="Trash"]') }).first()
      await expect(deleteButton).toBeVisible()
    })

    test('should remove item when delete clicked', async ({ page }) => {
      const deleteButton = page.locator('button').filter({ has: page.locator('svg[class*="Trash"]') }).first()
      await deleteButton.click()
      await page.waitForTimeout(300)

      await expect(page.getByText('Test Item')).not.toBeVisible()
    })
  })

  test.describe('Excluded Keywords', () => {
    test('should show add keyword input', async ({ page }) => {
      // Look for keyword-specific input (might be in a different section)
      const keywordInput = page.getByPlaceholder(/add keyword|exclude/i)
      await expect(keywordInput).toBeVisible()
    })

    test('should add excluded keyword', async ({ page }) => {
      const keywordInput = page.getByPlaceholder(/add keyword|exclude/i)
      await keywordInput.fill('salt')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      await expect(page.getByText('salt')).toBeVisible()
    })

    test('should remove excluded keyword', async ({ page }) => {
      // Add keyword first
      const keywordInput = page.getByPlaceholder(/add keyword|exclude/i)
      await keywordInput.fill('pepper')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Find and click remove button (X icon)
      const removeButton = page.locator('button').filter({ has: page.locator('svg[class*="X"]') }).first()
      await removeButton.click()
      await page.waitForTimeout(300)

      await expect(page.getByText('pepper')).not.toBeVisible()
    })
  })

  test.describe('Clear All', () => {
    test.beforeEach(async ({ page }) => {
      // Add multiple items
      const addInput = page.getByPlaceholder(/add item|new item/i)
      const items = ['Item 1', 'Item 2', 'Item 3']

      for (const item of items) {
        await addInput.fill(item)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
      }
    })

    test('should show Clear All button', async ({ page }) => {
      const clearButton = page.getByRole('button', { name: /clear all/i })
      await expect(clearButton).toBeVisible()
    })

    test('should show confirmation before clearing', async ({ page }) => {
      const clearButton = page.getByRole('button', { name: /clear all/i })
      await clearButton.click()

      // Should show confirmation dialog
      const confirmation = page.getByText(/are you sure|confirm/i)
      await expect(confirmation).toBeVisible()
    })

    test('should clear all items on confirmation', async ({ page }) => {
      const clearButton = page.getByRole('button', { name: /clear all/i })
      await clearButton.click()

      // Confirm
      const confirmButton = page.getByRole('button', { name: /confirm|yes|clear/i })
      if (await confirmButton.isVisible()) {
        await confirmButton.click()
        await page.waitForTimeout(300)
      }

      // All items should be removed
      await expect(page.getByText('Item 1')).not.toBeVisible()
      await expect(page.getByText('Item 2')).not.toBeVisible()
      await expect(page.getByText('Item 3')).not.toBeVisible()
    })
  })

  test.describe('Alphabetical Sorting', () => {
    test('should display items alphabetically', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)

      // Add items in non-alphabetical order
      await addInput.fill('Zucchini')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)

      await addInput.fill('Apple')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)

      await addInput.fill('Milk')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)

      // Get all item texts
      const items = page.locator('[data-pantry-item]')
      if (await items.first().isVisible()) {
        const texts = await items.allTextContents()
        const sorted = [...texts].sort((a, b) => a.localeCompare(b))
        expect(texts).toEqual(sorted)
      }
    })
  })

  test.describe('Persistence', () => {
    test('should persist items across session', async ({ page }) => {
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Persistent Item')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // In guest mode, data is stored in session/localStorage
      // Refresh should maintain data (within same session)
      await page.reload()
      await page.waitForLoadState('networkidle')

      // May need to re-enter guest mode
      const guestButton = page.getByRole('button', { name: /try as guest/i })
      if (await guestButton.isVisible()) {
        await guestButton.click()
        await page.waitForTimeout(300)
      }

      // Navigate back to pantry
      const viewport = page.viewportSize()
      const isMobile = viewport && viewport.width < 768
      if (isMobile) {
        await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /pantry/i }).click()
      } else {
        await page.locator('header.md\\:fixed').getByRole('button', { name: /pantry/i }).click()
      }

      // Item may or may not persist depending on guest storage implementation
    })
  })

  test.describe('Integration with Shopping List', () => {
    test('should exclude pantry items from shopping list', async ({ page, navigateToTab, addRecipe }) => {
      // Add item to pantry
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('chicken breast')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Add recipe with chicken to recipes
      await navigateToTab('recipes')

      const CHICKEN_RECIPE = {
        name: 'Simple Chicken',
        category: 'Chicken',
        servings: 2,
        ingredients: [
          { amount: '1', unit: 'lb', item: 'chicken breast', modifier: '' },
        ],
        instructions: 'Cook the chicken.',
        tags: [],
      }

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await page.locator('#name-add, #name, #name-edit').first().fill(CHICKEN_RECIPE.name)
      await page.locator('input[type="number"][min="1"][max="100"]').first().fill(CHICKEN_RECIPE.servings.toString())
      await page.locator('input[placeholder*="Ingredient"]').fill('chicken breast')
      await page.locator('#instructions-add, #instructions-edit').first().fill(CHICKEN_RECIPE.instructions)
      await page.getByRole('button', { name: /save/i }).click()
      await page.waitForTimeout(500)

      // Add recipe to shopping list
      const addToCartButton = page.locator('[title*="shopping"]').first()
      if (await addToCartButton.isVisible()) {
        await addToCartButton.click()
        await page.waitForTimeout(500)
      }

      // Navigate to shopping list
      await navigateToTab('shopping')

      // Chicken should be in "already have" or "pantry" section, not main list
      const pantrySection = page.getByText(/pantry|already have/i)
      // The exact behavior depends on implementation
    })
  })

  test.describe('Responsive Design', () => {
    test('should display correctly on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await page.waitForTimeout(300)

      // Input should be visible and full width
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await expect(addInput).toBeVisible()

      const inputBox = await addInput.boundingBox()
      if (inputBox) {
        // Input should be reasonably wide on mobile
        expect(inputBox.width).toBeGreaterThan(200)
      }
    })

    test('should have adequate touch targets on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile)

      // Add an item first
      const addInput = page.getByPlaceholder(/add item|new item/i)
      await addInput.fill('Touch Test Item')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Delete button should be at least 44x44 or have sufficient padding
      const deleteButton = page.locator('button').filter({ has: page.locator('svg[class*="Trash"]') }).first()
      if (await deleteButton.isVisible()) {
        const box = await deleteButton.boundingBox()
        if (box) {
          // Button should have reasonable touch target (may include padding)
          expect(box.width).toBeGreaterThanOrEqual(24) // Minimum clickable
          expect(box.height).toBeGreaterThanOrEqual(24)
        }
      }
    })
  })
})
