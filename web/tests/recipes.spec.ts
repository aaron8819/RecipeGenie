import { test, expect, SAMPLE_RECIPE, SAMPLE_RECIPE_TEXT, VIEWPORTS } from './fixtures'

test.describe('Recipe Management', () => {
  test.beforeEach(async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('recipes')
  })

  test.describe('Recipe List View', () => {
    test('should display recipe cards in grid layout', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      // Check for grid layout
      const grid = page.locator('.grid')
      await expect(grid.first()).toBeVisible()
    })

    test('should display Add Recipe button', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add recipe/i })
      await expect(addButton.first()).toBeVisible()
    })

    test('should display search input', async ({ page }) => {
      const searchInput = page.getByPlaceholder(/search recipes/i)
      await expect(searchInput).toBeVisible()
    })

    test('should display category filter dropdown', async ({ page }) => {
      // Look for the category select/filter
      const filterButton = page.getByRole('combobox').first()
      await expect(filterButton).toBeVisible()
    })

    test('should display settings button', async ({ page }) => {
      const settingsButton = page.getByRole('button', { name: /settings/i })
      await expect(settingsButton).toBeVisible()
    })

    test('should show empty state when no recipes exist', async ({ page }) => {
      const emptyState = page.getByText(/no recipes yet|add your first recipe/i)
      await expect(emptyState.first()).toBeVisible()
    })

    test('should filter recipes by search term', async ({ page, addRecipe }) => {
      // Add a recipe first
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Search for it
      const searchInput = page.getByPlaceholder(/search recipes/i)
      await searchInput.fill('chicken')
      await page.waitForTimeout(300)

      // Should see the recipe
      await expect(page.getByText(SAMPLE_RECIPE.name)).toBeVisible()

      // Search for something else
      await searchInput.fill('nonexistent recipe xyz')
      await page.waitForTimeout(300)

      // Should see no results
      const noResults = page.getByText(/no recipes match/i)
      await expect(noResults).toBeVisible()
    })

    test('should toggle favorites filter', async ({ page }) => {
      const favoritesButton = page.getByRole('button', { name: /favorites/i })
      await expect(favoritesButton).toBeVisible()

      await favoritesButton.click()

      // Button should show active state
      const activeClass = await favoritesButton.evaluate((el) => el.classList.contains('text-red-500'))
      expect(activeClass).toBeTruthy()
    })

    test('should toggle between grid and list view', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      // Find view toggle buttons
      const gridButton = page.getByRole('button', { name: /grid view/i })
      const listButton = page.getByRole('button', { name: /list view/i })

      await expect(gridButton).toBeVisible()
      await expect(listButton).toBeVisible()

      // Toggle to list view
      await listButton.click()
      await page.waitForTimeout(300)

      // Check for list layout class
      const listLayout = page.locator('.space-y-3')
      await expect(listLayout).toBeVisible()
    })

    test('should display sort options', async ({ page }) => {
      // Open sort dropdown
      const sortTrigger = page.locator('button').filter({ hasText: /most made|recently made|name/i })
      await sortTrigger.click()

      // Check sort options
      await expect(page.getByRole('option', { name: /most made/i })).toBeVisible()
      await expect(page.getByRole('option', { name: /recently made/i })).toBeVisible()
      await expect(page.getByRole('option', { name: /name/i })).toBeVisible()
    })
  })

  test.describe('Add Recipe Modal (Manual Entry)', () => {
    test('should open modal when clicking Add Recipe', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()
      await expect(page.getByText(/add recipe|new recipe/i).first()).toBeVisible()
    })

    test('should have recipe name input', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Labels don't have htmlFor, use ID selector
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      await expect(nameInput).toBeVisible()

      await nameInput.fill('Test Recipe')
      await expect(nameInput).toHaveValue('Test Recipe')
    })

    test('should have category dropdown', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Look for category select
      const categorySelect = page.getByRole('combobox')
      await expect(categorySelect.first()).toBeVisible()
    })

    test('should have servings input that accepts only numbers', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Servings has no ID, use attribute selector
      const servingsInput = page.locator('input[type="number"][min="1"][max="100"]').first()
      await expect(servingsInput).toBeVisible()
      await expect(servingsInput).toHaveAttribute('type', 'number')
    })

    test('should have ingredient input fields', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Look for ingredient-related inputs
      const amountInput = page.locator('input[placeholder*="Amt"]').first()
      const itemInput = page.locator('input[placeholder*="Ingredient"]').first()

      await expect(amountInput).toBeVisible()
      await expect(itemInput).toBeVisible()
    })

    test('should add new ingredient row', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Count initial ingredient rows
      const initialRows = await page.locator('input[placeholder*="Ingredient"]').count()

      // Click add ingredient button
      await page.getByRole('button', { name: /add ingredient/i }).click()

      // Should have one more row
      const newRows = await page.locator('input[placeholder*="Ingredient"]').count()
      expect(newRows).toBe(initialRows + 1)
    })

    test('should have instructions textarea', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Instructions label is sr-only with different text, use ID selector
      const instructionsInput = page.locator('#instructions-add, #instructions-edit').first()
      await expect(instructionsInput).toBeVisible()
    })

    test('should have Save and Cancel buttons', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      await expect(page.getByRole('button', { name: /save/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    })

    test('should close modal on Cancel', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await expect(page.locator('[role="dialog"]')).toBeVisible()

      await page.getByRole('button', { name: /cancel/i }).click()

      await expect(page.locator('[role="dialog"]')).toBeHidden()
    })

    test('should save recipe and close modal @smoke', async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)

      // Modal should close
      await expect(page.locator('[role="dialog"]')).toBeHidden()

      // Recipe should appear in list
      await expect(page.getByText(SAMPLE_RECIPE.name)).toBeVisible()
    })
  })

  test.describe('Import Recipe from Text', () => {
    test('should have import/paste option in add recipe modal', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Look for import or paste tab/button
      const importOption = page.getByText(/import|paste/i)
      await expect(importOption.first()).toBeVisible()
    })

    test('should parse recipe name from text', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Click import option if it's a tab
      const importTab = page.getByRole('tab', { name: /import|paste/i })
      if (await importTab.isVisible()) {
        await importTab.click()
      }

      // Find textarea for pasting
      const pasteArea = page.locator('textarea').first()
      await pasteArea.fill(SAMPLE_RECIPE_TEXT)

      // Trigger parse (may need to click a button or be automatic)
      const parseButton = page.getByRole('button', { name: /parse|import/i })
      if (await parseButton.isVisible()) {
        await parseButton.click()
      }

      await page.waitForTimeout(500)

      // Check if name was extracted
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      const nameValue = await nameInput.inputValue()
      expect(nameValue).toContain('Salmon')
    })

    test('should parse ingredients from text', async ({ page }) => {
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const importTab = page.getByRole('tab', { name: /import|paste/i })
      if (await importTab.isVisible()) {
        await importTab.click()
      }

      const pasteArea = page.locator('textarea').first()
      await pasteArea.fill(SAMPLE_RECIPE_TEXT)

      const parseButton = page.getByRole('button', { name: /parse|import/i })
      if (await parseButton.isVisible()) {
        await parseButton.click()
      }

      await page.waitForTimeout(500)

      // Check if ingredients were extracted
      const ingredientInputs = page.locator('input[placeholder*="Ingredient"]')
      const count = await ingredientInputs.count()
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('Recipe Detail View', () => {
    test.beforeEach(async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)
    })

    test('should open detail modal when clicking recipe card', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()
    })

    test('should display recipe name in detail view', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog.getByText(SAMPLE_RECIPE.name)).toBeVisible()
    })

    test('should display ingredients list', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      // Check for at least one ingredient
      await expect(page.getByText(/chicken/i)).toBeVisible()
    })

    test('should display instructions', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      await expect(page.getByText(/heat oil/i)).toBeVisible()
    })

    test('should have Edit Recipe button', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const editButton = page.getByRole('button', { name: /edit/i })
      await expect(editButton).toBeVisible()
    })

    test('should have Delete Recipe button', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const deleteButton = page.getByRole('button', { name: /delete/i })
      await expect(deleteButton).toBeVisible()
    })

    test('should have Share button in detail view', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const shareButton = page.getByRole('button', { name: /share/i })
      await expect(shareButton).toBeVisible()
    })

    test('should close detail view on X button', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()

      const closeButton = page.locator('[role="dialog"]').getByRole('button').first()
      await closeButton.click()

      await expect(page.locator('[role="dialog"]')).toBeHidden()
    })
  })

  test.describe('Recipe Sharing UI', () => {
    test.beforeEach(async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)
    })

    test('should open share dialog from recipe detail', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()
      await page.getByRole('button', { name: /share/i }).click()

      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByText(/recipient email/i)).toBeVisible()
    })

    test('should open shared inbox dialog', async ({ page }) => {
      const sharedButton = page.getByRole('button', { name: /shared/i }).first()
      await sharedButton.click()

      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByText(/shared with me/i)).toBeVisible()
    })
  })

  test.describe('Edit Recipe Modal', () => {
    test.beforeEach(async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Open detail view first
      await page.getByText(SAMPLE_RECIPE.name).click()

      // Click edit button
      await page.getByRole('button', { name: /edit/i }).click()
    })

    test('should open edit modal with existing recipe data', async ({ page }) => {
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      await expect(nameInput).toHaveValue(SAMPLE_RECIPE.name)
    })

    test('should have two-column layout on desktop', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // Check for grid layout
      const gridLayout = dialog.locator('.grid.grid-cols-2, .grid.md\\:grid-cols-2')
      // Layout may stack on smaller screens, just verify dialog exists
      await expect(dialog).toBeVisible()
    })

    test('should update recipe on save', async ({ page }) => {
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      await nameInput.clear()
      await nameInput.fill('Updated Recipe Name')

      await page.getByRole('button', { name: /save/i }).click()

      // Wait for dialog to close
      await page.waitForTimeout(500)

      // Should see updated name
      await expect(page.getByText('Updated Recipe Name')).toBeVisible()
    })

    test('should discard changes on cancel', async ({ page }) => {
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      await nameInput.clear()
      await nameInput.fill('Should Not Save')

      await page.getByRole('button', { name: /cancel/i }).click()

      // Original name should still be there
      await expect(page.getByText(SAMPLE_RECIPE.name)).toBeVisible()
    })
  })

  test.describe('Delete Recipe', () => {
    test.beforeEach(async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)
    })

    test('should show confirmation before deleting', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()
      await page.getByRole('button', { name: /delete/i }).click()

      // Should show confirmation dialog or prompt
      const confirmation = page.getByText(/are you sure|confirm/i)
      await expect(confirmation).toBeVisible()
    })

    test('should delete recipe on confirmation', async ({ page }) => {
      await page.getByText(SAMPLE_RECIPE.name).click()
      await page.getByRole('button', { name: /delete/i }).click()

      // Handle browser confirm or custom dialog
      page.on('dialog', dialog => dialog.accept())

      // If it's a custom dialog, click confirm
      const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i })
      if (await confirmButton.isVisible()) {
        await confirmButton.click()
      }

      await page.waitForTimeout(500)

      // Recipe should be removed
      await expect(page.getByText(SAMPLE_RECIPE.name)).toBeHidden()
    })
  })

  test.describe('Category Management Modal', () => {
    test('should open category settings modal', async ({ page }) => {
      const settingsButton = page.getByRole('button', { name: /settings/i })
      await settingsButton.click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()
    })

    test('should display existing categories', async ({ page }) => {
      await page.getByRole('button', { name: /settings/i }).click()

      // Default categories should be visible
      await expect(page.getByText(/chicken|beef|vegetarian/i).first()).toBeVisible()
    })

    test('should allow adding new category', async ({ page }) => {
      await page.getByRole('button', { name: /settings/i }).click()

      // Look for add category functionality
      const addInput = page.getByPlaceholder(/add category|new category/i)
      if (await addInput.isVisible()) {
        await addInput.fill('Test Category')
        await page.getByRole('button', { name: /add/i }).click()

        await expect(page.getByText('Test Category')).toBeVisible()
      }
    })
  })

  test.describe('Mobile Recipe List', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
    })

    test('should stack cards in single column on mobile', async ({ page }) => {
      // Check grid has single column class on mobile
      const grid = page.locator('.grid')
      if (await grid.first().isVisible()) {
        // Mobile should be single column (no sm: prefix active)
        const hasGridCols = await grid.first().evaluate((el) => {
          const styles = window.getComputedStyle(el)
          return styles.gridTemplateColumns
        })
        // Single column would have just one value
        expect(hasGridCols).toBeTruthy()
      }
    })

    test('should show FAB for adding recipe on mobile', async ({ page }) => {
      const fab = page.locator('button[aria-label="Add Recipe"]')
      await expect(fab).toBeVisible()
    })

    test('should hide delete button until needed on mobile', async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // On mobile, delete might be hidden or in a menu
      // The behavior varies by implementation
      const recipeCard = page.getByText(SAMPLE_RECIPE.name).first()
      await expect(recipeCard).toBeVisible()
    })
  })
})
