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
  const closeButton = page.getByRole('button', { name: /^close$/i }).first()
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
  } else {
    await page.keyboard.press('Escape')
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function searchRecipes(page: Page, value: string) {
  const input = page.getByLabel(/search recipes by name or category/i)
  await input.fill(value)
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
    await page.getByRole('button', { name: /add to shopping/i }).click()

    await closeDialog(page)
    await page.reload()
    await navigateToTab('recipes')
    await searchRecipes(page, recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()

    await navigateToTab('shopping')
    await expect(page.getByText(recipe.ingredients[0].item, { exact: true })).toBeVisible()
    await expect(page.getByText(recipe.ingredients[1].item, { exact: true })).toBeVisible()
  })
})
