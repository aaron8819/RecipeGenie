import { test, expect, VIEWPORTS } from './fixtures'
import type { Page, Locator } from '@playwright/test'

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

function buildRecipe(seed: string, category = 'Chicken'): RecipeDraft {
  return {
    name: `E2E Planner ${seed}`,
    category,
    servings: 4,
    ingredients: [
      { amount: '1', item: `planner protein ${seed}` },
      { amount: '2', item: `planner veg ${seed}` },
    ],
    instructions: `Prepare planner recipe ${seed}.\nServe warm.`,
  }
}

async function createRecipe(page: Page, recipe: RecipeDraft) {
  await page.getByRole('button', { name: /add recipe/i }).first().click()
  const dialog = page.getByRole('dialog').first()

  await expect(dialog).toBeVisible()
  await dialog.locator('#name-add').fill(recipe.name)
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: new RegExp(`^${escapeRegex(recipe.category)}$`, 'i') }).click()
  await dialog.locator('input[type="number"]').first().fill(String(recipe.servings))

  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    if (index > 0) {
      await dialog.getByRole('button', { name: /add row|add ingredient/i }).click()
    }

    await dialog.locator('input[placeholder="Amt"]').nth(index).fill(recipe.ingredients[index].amount)
    await dialog.locator('input[placeholder="Ingredient"]').nth(index).fill(recipe.ingredients[index].item)
  }

  await dialog.locator('textarea').first().fill(recipe.instructions)
  await dialog.getByRole('button', { name: /^add recipe$/i }).click()
  await expect(
    page.getByTestId('recipe-detail-page').getByRole('heading', {
      name: recipe.name,
      level: 1,
    })
  ).toBeVisible()
  await page.getByRole('button', { name: /back to recipes/i }).click()
  await expect(page.getByTestId('recipe-detail-page')).toHaveCount(0)
}

async function jumpWeeks(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    const currentWeek = await plannerWeekLabel(page).textContent()
    await page.getByRole('button', { name: /next week/i }).first().click()
    await expect(plannerWeekLabel(page)).not.toHaveText(currentWeek || '')
  }
}

function plannerWeekLabel(page: Page): Locator {
  return page.locator('h2').filter({ hasText: /[A-Za-z]+ \d{1,2}/ }).first()
}

async function openPlannerTab(page: Page) {
  await page.locator('header').getByRole('button', { name: /^planner$/i }).click()
}

async function handleGeneratePlan(page: Page) {
  const incrementButton = page.getByRole('button', { name: /^Increase .+ count$/ }).first()
  await expect(incrementButton).toBeVisible()
  await incrementButton.click()

  const generateButton = page.getByRole('button', { name: /generate plan/i }).first()
  await expect(generateButton).toBeEnabled()
  await generateButton.click()

  const confirmButton = page.getByRole('button', { name: /generate new plan/i })
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click()
  }

  await expect(page.getByRole('button', { name: /move to another day/i }).first()).toBeVisible()
}

async function addRecipeToCurrentWeek(page: Page, recipeName: string) {
  await page.getByRole('button', { name: /^add recipe$/i }).click()
  const dialog = page.getByRole('dialog').first()

  await expect(page.getByText(/add recipe to plan/i)).toBeVisible()
  await dialog.getByPlaceholder(/search recipes/i).fill(recipeName)
  await dialog.locator('li button').filter({ hasText: recipeName }).first().click()
  await dialog.getByRole('button', { name: /^add to plan$/i }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(plannerRecipeCard(page, recipeName)).toBeVisible()
}

function plannerRecipeCard(page: Page, recipeName: string): Locator {
  return page.locator(`xpath=//h4[normalize-space()="${recipeName}"]/ancestor::div[.//button[@aria-label="Move to another day"]][1]`)
}

async function moveRecipeToAnotherDay(page: Page, recipeName: string): Promise<string> {
  const card = plannerRecipeCard(page, recipeName)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /move to another day/i }).click()

  const menuItems = page.getByRole('menuitem')
  const count = await menuItems.count()

  for (let index = 0; index < count; index += 1) {
    const option = menuItems.nth(index)
    if (await option.isDisabled()) {
      continue
    }

    const label = (await option.textContent())?.trim()
    if (!label) {
      continue
    }

    await option.click()
    await expect(card).toBeVisible()
    return label
  }

  throw new Error(`No enabled day option found for ${recipeName}`)
}

async function expectAssignedDayDisabled(page: Page, recipeName: string, assignedDayLabel: string) {
  const card = plannerRecipeCard(page, recipeName)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /move to another day/i }).click()
  await expect(page.getByRole('menuitem', { name: assignedDayLabel, exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
}

test.describe.configure({ mode: 'serial' })

test.describe('Meal Planner', () => {
  test.beforeEach(async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.desktopLarge)
    await setupAuth()
    await openPlannerTab(page)
  })

  test('generates a plan for the visible week and keeps that week populated after reload @core', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-generate`

    await navigateToTab('recipes')
    await createRecipe(page, buildRecipe(seed))
    await navigateToTab('planner')

    const weekLabel = await plannerWeekLabel(page).textContent()
    await handleGeneratePlan(page)
    await expect(page.getByText(/\d+ of \d+ meals/i).first()).not.toHaveText(/^0 of 0 meals$/)

    await page.reload()
    await openPlannerTab(page)

    await expect(plannerWeekLabel(page)).toHaveText(weekLabel || '')
    await expect(page.getByRole('button', { name: /move to another day/i }).first()).toBeVisible()
  })

  test('adds a created recipe to plan, moves it to another day, and preserves the assignment after reload @core', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-move`
    const recipe = buildRecipe(seed)

    await navigateToTab('recipes')
    await createRecipe(page, recipe)
    await navigateToTab('planner')
    await jumpWeeks(page, 12)

    await addRecipeToCurrentWeek(page, recipe.name)
    const assignedDayLabel = await moveRecipeToAnotherDay(page, recipe.name)
    await expectAssignedDayDisabled(page, recipe.name, assignedDayLabel)

    const selectedWeekLabel = await plannerWeekLabel(page).textContent()
    await plannerRecipeCard(page, recipe.name).click()
    await expect(page).toHaveURL(/\/recipes\/[^/?]+\?from=planner/)
    await expect(
      page.getByRole('heading', { name: recipe.name, level: 1 })
    ).toBeVisible()
    await page.getByRole('button', { name: /back to planner/i }).click()
    await expect(plannerWeekLabel(page)).toHaveText(selectedWeekLabel || '')
    await expect(plannerRecipeCard(page, recipe.name)).toBeVisible()

    await page.reload()
    await openPlannerTab(page)
    await expect(plannerWeekLabel(page)).toHaveText(selectedWeekLabel || '')
    await expect(plannerRecipeCard(page, recipe.name)).toBeVisible()
    await expectAssignedDayDisabled(page, recipe.name, assignedDayLabel)
  })

  test('sends planned meal ingredients to Shopping and keeps the recipe linked back to Shopping on return @core', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-shopping`
    const recipe = buildRecipe(seed)

    await navigateToTab('recipes')
    await createRecipe(page, recipe)
    await navigateToTab('planner')

    await addRecipeToCurrentWeek(page, recipe.name)

    await page.getByRole('button', { name: /add planned meal ingredients to shopping/i }).click()

    await navigateToTab('shopping')
    await expect(page.getByText(new RegExp(recipe.ingredients[0].item, 'i')).first()).toBeVisible()
    await expect(page.getByText(new RegExp(`from ${escapeRegex(recipe.name)}`, 'i')).first()).toBeVisible()

    await navigateToTab('planner')
    await expect(plannerRecipeCard(page, recipe.name).getByText(/in shopping/i)).toBeVisible()
  })

  test('loads a saved template into the currently visible week @extended', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-template`
    const recipe = buildRecipe(seed)
    const templateName = `E2E Template ${seed}`

    await navigateToTab('recipes')
    await createRecipe(page, recipe)
    await navigateToTab('planner')
    await jumpWeeks(page, 16)

    await addRecipeToCurrentWeek(page, recipe.name)

    await page.getByRole('button', { name: /save template/i }).click()
    const saveDialog = page.getByRole('dialog').first()
    await saveDialog.getByLabel(/template name/i).fill(templateName)
    await saveDialog.getByRole('button', { name: /save template/i }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: /next week/i }).first().click()
    await expect(plannerRecipeCard(page, recipe.name)).toHaveCount(0)

    await page.getByRole('button', { name: /load template/i }).click()
    const loadDialog = page.getByRole('dialog').first()
    await expect(loadDialog).toBeVisible()

    const templateRow = loadDialog
      .getByText(templateName, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Load"]][1]')
    await templateRow.getByRole('button', { name: /^load$/i }).click()
    await page.getByRole('button', { name: /^load template$/i }).click()

    await expect(plannerRecipeCard(page, recipe.name)).toBeVisible()
  })
})
