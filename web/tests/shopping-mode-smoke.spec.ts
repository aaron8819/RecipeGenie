import {
  expect,
  test,
  reviewCreatedRecipe,
  saveReviewedRecipe,
  submitShoppingReview,
  expectShoppingSource,
} from './fixtures'

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
  const pantryVisible = await page
    .getByText(/^In Pantry$/i)
    .first()
    .isVisible()
    .catch(() => false)
  const excludedVisible = await page
    .getByText(/^Excluded$/i)
    .first()
    .isVisible()
    .catch(() => false)
  return activeCount > 0 || pantryVisible || excludedVisible
}

async function clearShoppingListIfNeeded(
  page: import('@playwright/test').Page,
  navigateToRoute: (route: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
) {
  await navigateToRoute('shopping')

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await shoppingHasVisibleState(page))) return

    await page.getByRole('button', { name: 'List actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Clear list', exact: true }).click()
    const confirmation = page.getByRole('alertdialog')
    if (await confirmation.isVisible().catch(() => false)) {
      await confirmation.getByRole('button', { name: 'Clear list', exact: true }).click()
    }

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
  smokeRecipe: SmokeRecipe,
) {
  await navigateToRoute('recipes')

  await createSmokeRecipe(page, smokeRecipe)
  const searchInput = page.getByLabel(/search recipes by name or category/i)
  await searchInput.fill(smokeRecipe.name)
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(smokeRecipe.name)
  const recipeCard = page.locator('[data-recipe-name]').filter({
    has: page.getByRole('heading', { level: 2, name: smokeRecipe.name, exact: true }),
  })
  const recipeHeading = recipeCard.getByRole('heading', {
    level: 2,
    name: smokeRecipe.name,
    exact: true,
  })

  await recipeHeading.waitFor({ state: 'visible', timeout: 15000 })

  await recipeCard.getByRole('button', { name: /actions/i }).click()
  await page.getByRole('menuitem', { name: /add to shopping list/i }).click()
  const review = page.getByRole('dialog')
  for (const [index, ingredient] of smokeRecipe.ingredients.entries()) {
    await review
      .getByRole('checkbox', {
        name: `${smokeRecipe.name}: ${ingredient.item}, ingredient ${index + 1}`,
        exact: true,
      })
      .check()
  }
  await submitShoppingReview(page, true)

  await navigateToRoute('shopping')
  await expect
    .poll(async () => page.locator('[data-checkbox="true"]').count(), {
      timeout: 10000,
    })
    .toBeGreaterThan(0)
}

async function createSmokeRecipe(page: import('@playwright/test').Page, smokeRecipe: SmokeRecipe) {
  await page
    .locator('[data-testid="recipes-add-button"], [data-testid="recipes-add-fab"]')
    .filter({ visible: true })
    .click()

  const dialog = page.getByRole('dialog', { name: /add recipe/i })
  await dialog.waitFor({ state: 'visible', timeout: 10000 })

  await dialog.getByRole('tab', { name: 'Manual', exact: true }).click()
  await dialog.getByLabel('Recipe Name', { exact: true }).fill(smokeRecipe.name)
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: new RegExp(`^${smokeRecipe.category}$`, 'i') }).click()
  await dialog
    .getByRole('spinbutton', { name: 'Scaling basis', exact: true })
    .fill(String(smokeRecipe.servings))

  const ingredientInputs = dialog.getByPlaceholder('Ingredient')
  while ((await ingredientInputs.count()) < smokeRecipe.ingredients.length) {
    await dialog.getByRole('button', { name: 'Add ingredient', exact: true }).click()
  }

  for (const [index, ingredient] of smokeRecipe.ingredients.entries()) {
    await ingredientInputs.nth(index).fill(ingredient.item)
    await dialog.getByPlaceholder('Amt').nth(index).fill(ingredient.amount)
    await dialog
      .getByLabel(`Unit for ingredient ${index + 1}`, { exact: true })
      .selectOption(ingredient.unit === 'cups' ? 'cup' : ingredient.unit)
  }

  await dialog
    .getByRole('textbox', { name: 'Instruction group 1 step 1', exact: true })
    .fill(smokeRecipe.instructions)
  await reviewCreatedRecipe(page)
  await saveReviewedRecipe(page)
  await expect(dialog).toBeHidden({ timeout: 15000 })

  const detailPage = page.getByTestId('recipe-detail-page')
  await expect(detailPage.getByRole('heading', { name: smokeRecipe.name, level: 1 })).toBeVisible()
  await detailPage.getByRole('button', { name: /back to recipes/i }).click()
  await expect(detailPage).toHaveCount(0)
}

async function seedPantryAndExcludedState(
  page: import('@playwright/test').Page,
  navigateToRoute: (route: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>,
  smokeRecipe: SmokeRecipe,
) {
  await navigateToRoute('pantry')

  const pantryInput = page.getByPlaceholder(/add pantry item/i)
  await pantryInput.waitFor({ state: 'visible', timeout: 10000 })
  await pantryInput.fill(smokeRecipe.pantryItem)
  await page.keyboard.press('Enter')
  await expect(page.getByText(smokeRecipe.pantryItem, { exact: true })).toBeVisible()

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
  await expect(page.getByText(smokeRecipe.excludedItem, { exact: true })).toBeVisible()
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

    const activeProduce = `apples smoke ${Date.now()}`
    await addItemInput.fill(activeProduce)
    await page.keyboard.press('Enter')
    await expect(page.getByText(activeProduce, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /^\d+ recipes/ }).click()
    await expect(
      page.getByRole('dialog').getByRole('heading', {
        name: 'Recipes in list',
        exact: true,
      }),
    ).toBeVisible()
    const recipeLink = page.getByRole('button', { name: `View ${smokeRecipe.name}`, exact: true })
    await expect(recipeLink).toBeVisible()
    await expect(recipeLink.getByText('4 selected servings', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectShoppingSource(page, smokeRecipe.ingredients[0].item, smokeRecipe.name)
    await expect(page.getByRole('button', { name: /^Reorder /i })).toHaveCount(0)
    await expect(page.getByText(/manage mode/i)).toHaveCount(0)

    const proteinHeading = page.getByRole('heading', { level: 2, name: /^Protein$/i })
    const produceHeading = page.getByRole('heading', { level: 2, name: /^Fresh Produce$/i }).first()
    await expect(proteinHeading).toBeVisible()
    await expect(produceHeading).toBeVisible()

    await page.getByRole('button', { name: /organize/i }).click()
    await page.getByRole('menuitem', { name: /enter manage mode/i }).click()

    await expect(page.getByText('Manage Mode', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Reorder /i }).first()).toBeVisible()
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

    await page.getByRole('button', { name: /^\d+ recipes/ }).click()
    await expect(
      page.getByRole('dialog').getByRole('heading', {
        name: 'Recipes in list',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('dialog').getByText(smokeRecipe.name, { exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const shoppingScreen = page.locator('[data-app-screen="shopping"]')
    await expect(page.getByRole('button', { name: /^Reorder /i })).toHaveCount(0)

    for (const name of ['Expand pantry items', 'Expand excluded items']) {
      await page.getByRole('button', { name, exact: true }).click()
    }

    await expect(page.getByRole('heading', { level: 2, name: /^In Pantry$/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^Excluded$/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(`restore ${smokeRecipe.pantryItem}`, 'i') }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(`restore ${smokeRecipe.excludedItem}`, 'i') }),
    ).toBeVisible()
    await expect(
      page.getByText(new RegExp(`Excluded: ${smokeRecipe.excludedItem}`, 'i')).first(),
    ).toBeVisible()

    const chickenRow = shoppingScreen
      .locator('[data-testid^="shopping-row-"]')
      .filter({ hasText: smokeRecipe.ingredients[0].item })
      .first()

    await chickenRow.getByRole('button', { name: /^Actions for / }).click()
    await expect(page.getByRole('menuitem', { name: 'Add to pantry', exact: true })).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: 'Remove from list', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
