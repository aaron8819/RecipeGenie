import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

type RecipeDraft = {
  name: string
  category: string
  servings: number
  ingredients: Array<{ amount: string; item: string }>
  instructions: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRecipe(seed: string): RecipeDraft {
  return {
    name: `E2E Recipe ${seed}`,
    category: 'Chicken',
    servings: 4,
    ingredients: [
      { amount: '1', item: `e2e chicken ${seed}` },
      { amount: '2', item: `e2e scallion ${seed}` },
      { amount: '3', item: `e2e spice ${seed}` },
    ],
    instructions: `Cook recipe ${seed} until done.\nServe immediately.`,
  }
}

async function openAddRecipeDialog(page: Page) {
  await page.getByRole('button', { name: /add recipe/i }).first().click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /^add recipe$/i })).toBeVisible()
}

async function createRecipe(page: Page, recipe: RecipeDraft) {
  await openAddRecipeDialog(page)

  const dialog = page.getByRole('dialog').first()
  await dialog.locator('#name-add').fill(recipe.name)

  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: new RegExp(`^${escapeRegex(recipe.category)}$`, 'i') }).click()

  const servingsInput = dialog.locator('input[type="number"]').first()
  await servingsInput.fill(String(recipe.servings))

  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const ingredient = recipe.ingredients[index]

    if (index > 0) {
      await dialog.getByRole('button', { name: /add row|add ingredient/i }).click()
    }

    await dialog.locator('input[placeholder="Amt"]').nth(index).fill(ingredient.amount)
    await dialog.locator('input[placeholder="Ingredient"]').nth(index).fill(ingredient.item)
  }

  await dialog.locator('textarea').first().fill(recipe.instructions)
  await dialog.getByRole('button', { name: /^add recipe$/i }).click()

  await expect(page.getByRole('dialog').last().locator('h1').filter({ hasText: recipe.name })).toBeVisible()
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function searchRecipes(page: Page, value: string) {
  const input = page.getByLabel(/search recipes by name or category/i)
  await input.fill(value)
}

async function addOpenRecipeToShopping(page: Page) {
  const detailDialog = page.getByRole('dialog').last()
  const button = detailDialog.getByRole('button', { name: /add to shopping list/i })
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes('/api/shopping/recipe-contributions') &&
    candidate.request().method() === 'POST'
  )
  await button.click()
  expect((await response).ok()).toBe(true)
  await expect(button).toBeEnabled({ timeout: 15000 })
}

async function deleteOpenRecipe(page: Page) {
  const detailDialog = page.getByRole('dialog').last()
  await detailDialog.getByRole('button', { name: /delete recipe/i }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.describe.configure({ mode: 'serial' })

test.describe('Recipes', () => {
  test.beforeEach(async ({ setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('recipes')
  })

  test('creates a recipe, finds it deterministically, opens detail, and edits the same recipe from detail @core', async ({ page }) => {
    const seed = `${Date.now()}-crud`
    const recipe = buildRecipe(seed)
    const updatedName = `Renamed Recipe ${seed}`

    await createRecipe(page, recipe)
    await expect(page.getByText(new RegExp(escapeRegex(recipe.ingredients[0].item), 'i'))).toBeVisible()

    await closeDialog(page)
    await searchRecipes(page, recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()

    await page.getByText(recipe.name, { exact: true }).click()
    await expect(page.getByRole('dialog').last().locator('h1').filter({ hasText: recipe.name })).toBeVisible()

    await page.getByRole('button', { name: /edit recipe/i }).click()
    const editDialog = page.getByRole('dialog').first()
    await expect(editDialog.locator('h1').filter({ hasText: /^edit recipe$/i })).toBeVisible()
    await editDialog.locator('#name-edit').fill(updatedName)
    await editDialog.getByRole('button', { name: /save changes/i }).click()
    await expect(editDialog).toBeHidden({ timeout: 15000 })
    if (await page.getByRole('dialog').first().isVisible().catch(() => false)) {
      await closeDialog(page)
    }

    await searchRecipes(page, recipe.name)
    await expect(page.getByText(/no recipes match the current search and filters/i)).toBeVisible()

    await searchRecipes(page, updatedName)
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible()
  })

  test('shows recipe detail actions and adds its ingredients to shopping @extended', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-actions`
    const recipe = buildRecipe(seed)

    await createRecipe(page, recipe)

    const detailDialog = page.getByRole('dialog').last()
    await expect(
      detailDialog.getByRole('button', { name: /start cooking/i })
    ).toBeVisible()
    await expect(
      detailDialog.getByRole('button', { name: /add to shopping list/i })
    ).toBeVisible()
    await expect(
      detailDialog.getByRole('button', { name: /add to plan/i })
    ).toBeVisible()
    await expect(
      detailDialog.getByRole('button', { name: /^share$/i })
    ).toBeVisible()
    await expect(
      detailDialog.getByRole('button', { name: /edit recipe/i })
    ).toBeVisible()
    await expect(
      detailDialog.getByRole('button', { name: /^mark made$/i })
    ).toHaveCount(0)
    const addToShoppingButton = detailDialog.getByRole('button', { name: /add to shopping list/i })
    await addToShoppingButton.click()
    await expect(addToShoppingButton).toBeDisabled()
    await expect(addToShoppingButton).toBeEnabled({ timeout: 15000 })

    await closeDialog(page)
    await page.reload()
    await navigateToTab('recipes')
    await searchRecipes(page, recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()

    await navigateToTab('shopping')
    await page.getByRole('button', { name: /jump to protein/i }).click()
    await expect(page.getByText(recipe.ingredients[0].item, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /jump to fresh produce/i }).click()
    await expect(page.getByText(recipe.ingredients[1].item, { exact: true })).toBeVisible()
  })

  test('imports pasted recipe text into an editable recipe and saves it @extended', async ({ page }) => {
    const seed = `${Date.now()}-import`
    const recipeName = `Imported E2E Recipe ${seed}`
    const ingredient = `imported ingredient ${seed}`

    await openAddRecipeDialog(page)
    const dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: /^import$/i }).click()
    await dialog.getByLabel('Paste Recipe Text').fill(`${recipeName}\nServes 2\n\nIngredients:\n1 cup ${ingredient}\n\nInstructions:\n1. Cook until ready.`)

    await expect(dialog.getByText(recipeName, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /apply to form/i }).click()
    await expect(dialog.locator('#name-add')).toHaveValue(recipeName)
    await expect(dialog.locator('input[placeholder="Ingredient"]').first()).toHaveValue(ingredient)

    await dialog.getByRole('button', { name: /^add recipe$/i }).click()
    await expect(page.getByRole('dialog').last().locator('h1').filter({ hasText: recipeName })).toBeVisible()
  })

  test('deletes an active recipe contribution through one visible confirmation @smoke', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-delete`
    const recipe = {
      ...buildRecipe(seed),
      ingredients: [{ amount: '1', item: `delete ingredient ${seed}` }],
    }
    let nativeConfirmCount = 0
    page.on('dialog', async (dialog) => {
      nativeConfirmCount += 1
      await dialog.dismiss()
    })

    await createRecipe(page, recipe)
    const detailDialog = page.getByRole('dialog').last()
    const addToShoppingButton = detailDialog.getByRole('button', { name: /add to shopping list/i })
    await addToShoppingButton.click()
    await expect(addToShoppingButton).toBeEnabled({ timeout: 15000 })

    await detailDialog.getByRole('button', { name: /delete recipe/i }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    const confirmButton = confirmation.getByRole('button', { name: /^delete$/i })
    await expect(confirmButton).toBeVisible()
    await expect(confirmButton).toBeEnabled()

    const contributionResponse = page.waitForResponse((response) =>
      response.url().includes('/api/shopping/recipe-contributions') &&
      response.request().method() === 'DELETE'
    )
    const recipeResponse = page.waitForResponse((response) =>
      response.url().includes('/rest/v1/recipes') &&
      response.request().method() === 'DELETE'
    )

    await confirmButton.click()
    const [contributionResult, recipeResult] = await Promise.all([
      contributionResponse,
      recipeResponse,
    ])

    expect(contributionResult.ok()).toBe(true)
    expect(recipeResult.ok()).toBe(true)
    expect(nativeConfirmCount).toBe(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await searchRecipes(page, recipe.name)
    await expect(page.getByText(/no recipes match the current search and filters/i)).toBeVisible()

    await navigateToTab('shopping')
    await expect(page.getByText(recipe.ingredients[0].item, { exact: true })).toHaveCount(0)
  })

  test('preserves supported pantry and exclusion lifecycle actions across replacement @smoke', async ({ page, navigateToTab }) => {
    test.setTimeout(120000)
    const seed = `${Date.now()}-lifecycle`
    const pantryRecipe = {
      ...buildRecipe(`${seed}-pantry`),
      ingredients: [{ amount: '1', item: `pantry lifecycle ${seed}` }],
    }
    const exclusionRecipe = {
      ...buildRecipe(`${seed}-excluded`),
      ingredients: [{ amount: '1', item: `excluded lifecycle ${seed}` }],
    }

    await createRecipe(page, pantryRecipe)
    await addOpenRecipeToShopping(page)
    await closeDialog(page)
    await navigateToTab('shopping')

    const pantryRow = page.getByText(pantryRecipe.ingredients[0].item, { exact: true })
      .locator('xpath=ancestor::*[.//button[@aria-label="Add to pantry"]][1]')
    const pantryResponse = page.waitForResponse((response) =>
      response.url().includes('/rest/v1/rpc/move_shopping_item_to_pantry')
    )
    await pantryRow.getByRole('button', { name: /add to pantry/i }).click()
    expect((await pantryResponse).ok()).toBe(true)
    await expect(page.getByRole('button', {
      name: new RegExp(`^Restore ${escapeRegex(pantryRecipe.ingredients[0].item)}`, 'i'),
    })).toBeVisible()

    await navigateToTab('recipes')
    await searchRecipes(page, pantryRecipe.name)
    await page.getByText(pantryRecipe.name, { exact: true }).click()
    await addOpenRecipeToShopping(page)
    await closeDialog(page)
    await navigateToTab('shopping')
    const pantryRestore = page.getByRole('button', {
      name: new RegExp(`^Restore ${escapeRegex(pantryRecipe.ingredients[0].item)}`, 'i'),
    })
    await expect(pantryRestore).toBeVisible()
    await pantryRestore.click()
    await expect(page.getByText(pantryRecipe.ingredients[0].item, { exact: true })).toBeVisible()

    await navigateToTab('pantry')
    const removePantryButton = page.getByRole('button', {
      name: new RegExp(`remove ${escapeRegex(pantryRecipe.ingredients[0].item)}`, 'i'),
    })
    await removePantryButton.click()
    await expect(removePantryButton).toHaveCount(0)

    const excludedInput = page.getByPlaceholder(/add excluded keyword \(comma-separated\)/i)
    await excludedInput.fill(exclusionRecipe.ingredients[0].item)
    await page.keyboard.press('Enter')
    await expect(page.getByText(exclusionRecipe.ingredients[0].item, { exact: true })).toBeVisible()

    await navigateToTab('recipes')
    await createRecipe(page, exclusionRecipe)
    await addOpenRecipeToShopping(page)
    await closeDialog(page)
    await navigateToTab('shopping')
    const excludedRestore = page.getByRole('button', {
      name: new RegExp(`^Restore ${escapeRegex(exclusionRecipe.ingredients[0].item)}`, 'i'),
    })
    await expect(excludedRestore).toBeVisible()

    await navigateToTab('recipes')
    await searchRecipes(page, exclusionRecipe.name)
    await page.getByText(exclusionRecipe.name, { exact: true }).click()
    await addOpenRecipeToShopping(page)
    await closeDialog(page)
    await navigateToTab('shopping')
    await expect(excludedRestore).toBeVisible()
    await excludedRestore.click()
    await expect(
      page.locator('[data-testid^="shopping-row-"]').filter({
        hasText: exclusionRecipe.ingredients[0].item,
      })
    ).toBeVisible()

    await navigateToTab('pantry')
    await page.getByRole('button', {
      name: new RegExp(`remove excluded keyword ${escapeRegex(exclusionRecipe.ingredients[0].item)}`, 'i'),
    }).click()
    await navigateToTab('recipes')

    for (const recipe of [pantryRecipe, exclusionRecipe]) {
      await searchRecipes(page, recipe.name)
      await page.getByText(recipe.name, { exact: true }).click()
      await deleteOpenRecipe(page)
    }
  })

})
