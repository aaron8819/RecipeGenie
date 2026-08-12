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
  const activeItem = `chicken breast smoke ${seed}`

  return {
    name: `Smoke Stir Fry ${seed}`,
    category: 'Chicken',
    servings: 4,
    pantryItem,
    excludedItem,
    ingredients: [
      { amount: '1', unit: 'lb', item: activeItem, modifier: 'cubed' },
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
  navigateToRoute: (route: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>
) {
  await navigateToRoute('shopping')

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
  navigateToRoute: (route: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
  smokeRecipe: SmokeRecipe
) {
  await navigateToRoute('recipes')

  const searchInput = page.getByPlaceholder(/search by recipe name or category/i)
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(smokeRecipe.name)
  }

  let recipeCard = page
    .locator('[data-recipe-name]')
    .filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') }) })
  let recipeHeading = recipeCard.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') })

  if (!(await recipeHeading.isVisible().catch(() => false))) {
    await createSmokeRecipe(page, smokeRecipe)
    await searchInput.fill(smokeRecipe.name)
    recipeCard = page
      .locator('[data-recipe-name]')
      .filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') }) })
    recipeHeading = recipeCard.getByRole('heading', { level: 3, name: new RegExp(smokeRecipe.name, 'i') })
  }

  await recipeHeading.waitFor({ state: 'visible', timeout: 15000 })

  const viewport = page.viewportSize()
  const isMobile = !!viewport && viewport.width < 768

  if (isMobile) {
    const directShoppingButton = recipeCard.getByRole('button', { name: /add to shopping list/i })
    if (await directShoppingButton.isVisible().catch(() => false)) {
      await directShoppingButton.click()
    } else {
      await recipeCard.getByRole('button', { name: /actions/i }).click()
      await expect(page.getByRole('menuitem', { name: /add to shopping list/i })).toBeVisible()
      await page.getByRole('menuitem', { name: /add to shopping list/i }).click()
    }
  } else {
    await recipeCard.getByRole('button', { name: /^shop$/i }).click()
  }

  await navigateToRoute('shopping')
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
  await page
    .locator('[data-testid="recipes-add-button"], [data-testid="recipes-add-fab"]')
    .filter({ visible: true })
    .click()

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

  await dialog.locator('textarea').first().fill(smokeRecipe.instructions)
  await dialog.getByRole('button', { name: /^add recipe$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  const detailPage = page.getByTestId('recipe-detail-page')
  await expect(
    detailPage.getByRole('heading', { name: smokeRecipe.name, level: 1 })
  ).toBeVisible()
  await detailPage.getByRole('button', { name: /back to recipes/i }).click()
  await expect(detailPage).toHaveCount(0)
}

async function seedPantryAndExcludedState(
  page: import('@playwright/test').Page,
  navigateToRoute: (route: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
  smokeRecipe: SmokeRecipe
) {
  await navigateToRoute('pantry')

  const pantryInput = page.getByPlaceholder(/add pantry item/i)
  await pantryInput.waitFor({ state: 'visible', timeout: 10000 })
  await pantryInput.fill(smokeRecipe.pantryItem)
  await page.keyboard.press('Enter')

  const excludedInput = page.getByPlaceholder(/add excluded keyword/i)
  if (!(await excludedInput.isVisible().catch(() => false))) {
    await page
      .getByRole('navigation', { name: /pantry sections/i })
      .getByRole('button', { name: /^excluded/i })
      .click()
  }
  await excludedInput.waitFor({ state: 'visible', timeout: 10000 })
  await excludedInput.fill(smokeRecipe.excludedItem)
  await page.keyboard.press('Enter')
}

async function revealMobileSwipeActions(row: import('@playwright/test').Locator) {
  await row.scrollIntoViewIfNeeded()
  const box = await row.boundingBox()
  if (!box) throw new Error('Shopping row is not visible for swipe validation')

  const startX = Math.round(box.x + box.width - 16)
  const endX = Math.round(box.x + box.width - 140)
  const y = Math.round(box.y + box.height / 2)

  const dispatchTouch = async (type: 'touchstart' | 'touchmove' | 'touchend', x: number) => {
    await row.evaluate(
      (node, eventData) => {
        const event = new Event(eventData.type, { bubbles: true, cancelable: true })
        const touch = { clientX: eventData.x, clientY: eventData.y }
        const activeTouches = eventData.type === 'touchend' ? [] : [touch]
        Object.defineProperty(event, 'touches', { configurable: true, value: activeTouches })
        Object.defineProperty(event, 'targetTouches', { configurable: true, value: activeTouches })
        Object.defineProperty(event, 'changedTouches', { configurable: true, value: [touch] })
        node.dispatchEvent(event)
      },
      { type, x, y }
    )
  }

  await dispatchTouch('touchstart', startX)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await dispatchTouch('touchmove', endX)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await dispatchTouch('touchend', endX)
}

test.describe('Shopping Mode Smoke @core', () => {
  test('keeps shopping mode dense by default and reveals manage controls only on demand @smoke', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    const smokeRecipe = buildSmokeRecipe(`${Date.now()}`)

    await setupAuth()
    await seedPantryAndExcludedState(page, navigateToRoute, smokeRecipe)
    await clearShoppingListIfNeeded(page, navigateToRoute)
    await ensureRecipeAddedToShopping(page, navigateToRoute, smokeRecipe)

    const addItemInput = page.getByPlaceholder(/Add (tomatoes|milk)/).filter({ visible: true })
    const manualItem = `smoke apples ${Date.now()}`
    await addItemInput.fill(manualItem)
    await page.keyboard.press('Enter')
    await expect(page.getByText(manualItem, { exact: true })).toBeVisible()
    await page
      .locator('[data-testid^="shopping-row-"]')
      .filter({ has: page.getByText(manualItem, { exact: true }) })
      .locator('[data-checkbox="true"]')
      .click()

    await expect(page.getByText(/recipes in list/i)).toBeVisible()
    await expect(page.getByRole('button', {
      name: new RegExp(`^${smokeRecipe.name} chicken · 4 servings$`, 'i'),
    })).toBeVisible()
    await expect(page.getByText(/^from /i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)
    await expect(page.getByText(/manage mode/i)).toHaveCount(0)

    const proteinHeading = page.getByRole('heading', { level: 3, name: /^Protein$/i })
    const produceHeading = page.getByRole('heading', { level: 3, name: /^Fresh Produce$/i }).first()
    await expect(proteinHeading).toBeVisible()
    await expect(produceHeading).toBeVisible()

    await page.getByRole('button', { name: /organize/i }).click()
    await page.getByRole('menuitem', { name: /enter manage mode/i }).click()

    await expect(page.getByText('Manage Mode', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i }).first()).toBeVisible()
  })
})

test.describe('Shopping Mode Smoke Mobile @extended', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('keeps mobile quick actions and richer restore context available @smoke', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    const smokeRecipe = buildSmokeRecipe(`${Date.now()}`)

    await setupAuth()
    await seedPantryAndExcludedState(page, navigateToRoute, smokeRecipe)
    await clearShoppingListIfNeeded(page, navigateToRoute)
    await ensureRecipeAddedToShopping(page, navigateToRoute, smokeRecipe)

    await expect(page.getByText(/recipes in list/i)).toBeVisible()
    const showRecipesButton = page.getByRole('button', { name: /show recipes in list/i })
    await expect(showRecipesButton).toBeVisible()
    await showRecipesButton.click()
    const shoppingScreen = page.locator('[data-app-screen="shopping"]')
    await expect(shoppingScreen.getByText(new RegExp(smokeRecipe.name, 'i')).first()).toBeVisible()
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

    const chickenRow = shoppingScreen
      .locator('[data-testid^="shopping-row-"]')
      .filter({ hasText: smokeRecipe.ingredients[0].item })
      .first()

    await revealMobileSwipeActions(chickenRow)

    await expect(page.getByRole('button', { name: /quick add to pantry/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /quick remove item/i })).toBeVisible()
  })
})
