import { expect, test } from './fixtures'

test.describe.configure({ mode: 'serial' })

type SmokeRecipe = {
  name: string
  category: string
  servings: number
  pantryItem: string
  excludedItem: string
  ingredients: Array<{ amount: string; unit: string; item: string; modifier: string }>
  instructions: string
  tags: string[]
}

function buildSmokeRecipe(seed: string): SmokeRecipe {
  const pantryItem = `broccoli smoke ${seed}`
  const excludedItem = `soy sauce smoke ${seed}`

  return {
    name: `Smoke Stir Fry ${seed}`,
    category: 'Chicken',
    servings: 4,
    pantryItem,
    excludedItem,
    ingredients: [
      { amount: '1', unit: 'lb', item: 'chicken breast', modifier: 'cubed' },
      { amount: '2', unit: 'cups', item: pantryItem, modifier: 'chopped' },
      { amount: '3', unit: 'tbsp', item: excludedItem, modifier: '' },
    ],
    instructions:
      'Cook chicken, add broccoli, stir in soy sauce, and finish until everything is coated.',
    tags: ['smoke'],
  }
}

async function shoppingHasVisibleState(page: import('@playwright/test').Page) {
  const activeCount = await page.locator('[data-checkbox="true"]').count()
  const pantryVisible = await page.getByText(/^In Pantry$/i).first().isVisible().catch(() => false)
  const excludedVisible = await page.getByText(/^Excluded$/i).first().isVisible().catch(() => false)
  return activeCount > 0 || pantryVisible || excludedVisible
}

async function clearShoppingListIfNeeded(
  page: import('@playwright/test').Page,
  navigateToTab: (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>
) {
  await navigateToTab('shopping')

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await shoppingHasVisibleState(page))) return

    const clearButton = page
      .getByRole('button', { name: /^clear$/i })
      .or(page.getByLabel(/clear list/i))
      .first()

    if (!(await clearButton.isVisible().catch(() => false))) return

    await clearButton.click()

    const dismissButton = page.getByRole('button', { name: /^dismiss$/i })
    if (await dismissButton.isVisible().catch(() => false)) {
      await dismissButton.click()
    }

    await expect
      .poll(async () => page.locator('[data-checkbox="true"]').count(), {
        timeout: 10000,
      })
      .toBe(0)
  }
}

async function ensureRecipeAddedToShopping(
  page: import('@playwright/test').Page,
  navigateToTab: (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
  smokeRecipe: SmokeRecipe
) {
  await navigateToTab('recipes')

  const searchInput = page.getByPlaceholder(/search recipes by name or cuisine/i)
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(smokeRecipe.name)
  }

  let recipeHeading = page
    .locator('article, [data-testid^="recipe-card-"], .group')
    .filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') }) })
    .getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') })
    .first()

  if (!(await recipeHeading.isVisible().catch(() => false))) {
    await createSmokeRecipe(page, smokeRecipe)
    await searchInput.fill(smokeRecipe.name)
    recipeHeading = page
      .locator('article, [data-testid^="recipe-card-"], .group')
      .filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') }) })
      .getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') })
      .first()
  }

  await recipeHeading.waitFor({ state: 'visible', timeout: 15000 })

  const recipeCardControls = recipeHeading.locator('xpath=ancestor::div[1]')
  const viewport = page.viewportSize()
  const isMobile = !!viewport && viewport.width < 768

  if (isMobile) {
    await recipeCardControls.getByRole('button', { name: /actions/i }).click({ force: true })
    await expect(page.getByRole('menuitem', { name: /add to shopping list/i })).toBeVisible()
    await page.getByRole('menuitem', { name: /add to shopping list/i }).click()
  } else {
    await recipeCardControls.getByRole('button', { name: /^shop$/i }).click()
  }

  await navigateToTab('shopping')
  await expect
    .poll(async () => page.locator('[data-checkbox="true"]').count(), {
      timeout: 10000,
    })
    .toBeGreaterThan(0)
}

async function createSmokeRecipe(
  page: import('@playwright/test').Page,
  smokeRecipe: SmokeRecipe
) {
  await page.getByRole('button', { name: /add recipe/i }).click()

  const dialog = page.getByRole('dialog', { name: /add recipe/i })
  await dialog.waitFor({ state: 'visible', timeout: 10000 })

  await dialog.getByRole('textbox', { name: /e\.g\. grandma's roast chicken/i }).fill(smokeRecipe.name)

  const ingredientInputs = dialog.getByPlaceholder('Ingredient')
  while ((await ingredientInputs.count()) < smokeRecipe.ingredients.length) {
    await dialog.getByRole('button', { name: /add row/i }).click()
  }

  for (const [index, ingredient] of smokeRecipe.ingredients.entries()) {
    await ingredientInputs.nth(index).fill(ingredient.item)
    await dialog.getByPlaceholder('Amt').nth(index).fill(ingredient.amount)
  }

  await dialog.getByRole('textbox', { name: /instructions/i }).fill(smokeRecipe.instructions)
  await dialog.getByRole('button', { name: /^add recipe$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  const detailDialog = page.getByRole('dialog', { name: new RegExp(smokeRecipe.name, 'i') })
  if (await detailDialog.isVisible().catch(() => false)) {
    await detailDialog.getByRole('button', { name: /^close$/i }).click()
    await expect(detailDialog).toBeHidden({ timeout: 10000 })
  }
}

async function seedPantryAndExcludedState(
  page: import('@playwright/test').Page,
  navigateToTab: (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
  smokeRecipe: SmokeRecipe
) {
  await navigateToTab('pantry')

  const pantryInput = page.getByPlaceholder(/add pantry item/i)
  await pantryInput.waitFor({ state: 'visible', timeout: 10000 })
  await pantryInput.fill(smokeRecipe.pantryItem)
  await page.keyboard.press('Enter')

  const excludedInput = page.getByPlaceholder(/add excluded keyword/i)
  await excludedInput.waitFor({ state: 'visible', timeout: 10000 })
  await excludedInput.fill(smokeRecipe.excludedItem)
  await page.keyboard.press('Enter')
}

async function revealMobileSwipeActions(row: import('@playwright/test').Locator) {
  const box = await row.boundingBox()
  if (!box) throw new Error('Shopping row is not visible for swipe validation')

  const startX = Math.round(box.x + box.width - 16)
  const endX = Math.round(box.x + box.width - 140)
  const y = Math.round(box.y + box.height / 2)

  await row.evaluate(
    (node, coords) => {
      const dispatchTouch = (type: string, x: number, y: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        const touches = [{ clientX: x, clientY: y }]
        Object.defineProperty(event, 'touches', { configurable: true, value: touches })
        Object.defineProperty(event, 'targetTouches', { configurable: true, value: touches })
        Object.defineProperty(event, 'changedTouches', { configurable: true, value: touches })
        node.dispatchEvent(event)
      }

      dispatchTouch('touchstart', coords.startX, coords.y)
      dispatchTouch('touchmove', coords.endX, coords.y)
      dispatchTouch('touchend', coords.endX, coords.y)
    },
    { startX, endX, y }
  )
}

test.describe('Shopping Mode Smoke @core', () => {
  test('keeps shopping mode dense by default and reveals manage controls only on demand @smoke', async ({
    page,
    setupAuth,
    navigateToTab,
  }) => {
    const smokeRecipe = buildSmokeRecipe(`${Date.now()}`)

    await setupAuth()
    await seedPantryAndExcludedState(page, navigateToTab, smokeRecipe)
    await clearShoppingListIfNeeded(page, navigateToTab)
    await ensureRecipeAddedToShopping(page, navigateToTab, smokeRecipe)

    const addItemInput = page.getByPlaceholder('Add milk, apples, basil...').first()
    await addItemInput.fill('apples')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/^apples$/i)).toBeVisible()
    await page
      .locator('[data-testid^="shopping-row-"]')
      .filter({ hasText: /^apples$/i })
      .first()
      .locator('[data-checkbox="true"]')
      .click()

    await expect(page.getByText(/recipes in list/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /show recipes in list/i })).toBeVisible()
    await expect(page.getByText(/^from /i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)
    await expect(page.getByText(/manage mode/i)).toHaveCount(0)

    const proteinHeading = page.getByRole('heading', { level: 3, name: /^Protein$/i })
    const produceHeading = page.getByRole('heading', { level: 3, name: /^Fresh Produce$/i }).first()
    const proteinBox = await proteinHeading.boundingBox()
    const produceBox = await produceHeading.boundingBox()

    expect(proteinBox).not.toBeNull()
    expect(produceBox).not.toBeNull()
    expect((proteinBox?.y ?? 0) < (produceBox?.y ?? 0)).toBe(true)

    await page.getByRole('button', { name: /organize/i }).click()
    await page.getByRole('menuitem', { name: /enter manage mode/i }).click()

    await expect(page.getByText(/manage mode/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i }).first()).toBeVisible()
  })
})

test.describe('Shopping Mode Smoke Mobile @extended', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('keeps mobile quick actions and richer restore context available @smoke', async ({
    page,
    setupAuth,
    navigateToTab,
  }) => {
    const smokeRecipe = buildSmokeRecipe(`${Date.now()}`)

    await setupAuth()
    await seedPantryAndExcludedState(page, navigateToTab, smokeRecipe)
    await clearShoppingListIfNeeded(page, navigateToTab)
    await ensureRecipeAddedToShopping(page, navigateToTab, smokeRecipe)

    await expect(page.getByText(/recipes in list/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /show recipes in list/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)

    const expandPantry = page.getByRole('button', { name: /in pantry .*expand pantry items/i })
    if (await expandPantry.isVisible().catch(() => false)) {
      await expandPantry.click()
    }

    const expandExcluded = page.getByRole('button', { name: /excluded .*expand excluded items/i })
    if (await expandExcluded.isVisible().catch(() => false)) {
      await expandExcluded.click()
    }

    await expect(page.getByRole('heading', { level: 3, name: /^In Pantry$/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: /^Excluded$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`restore ${smokeRecipe.pantryItem}`, 'i') })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`restore ${smokeRecipe.excludedItem}`, 'i') })).toBeVisible()
    await expect(page.getByText(new RegExp(`Excluded: ${smokeRecipe.excludedItem}`, 'i')).first()).toBeVisible()
    await expect(page.getByText(new RegExp(smokeRecipe.name, 'i')).first()).toBeVisible()

    const chickenRow = page
      .locator('[data-testid^="shopping-row-"]')
      .filter({ hasText: /chicken breast/i })
      .first()

    await revealMobileSwipeActions(chickenRow)

    await expect(page.getByRole('button', { name: /quick add to pantry/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /quick remove item/i })).toBeVisible()
  })
})
