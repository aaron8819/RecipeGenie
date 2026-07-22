import { expect, test } from './fixtures'
import { E2E_CONFIG } from './e2e-env'

const recipes = {
  simple: `Lemon Herb Couscous
Serves 4
Prep Time: 10 minutes
Cook Time: 10 minutes
Total Time: 20 minutes

Ingredients:
1 cup couscous
1 cup vegetable broth
2 tbsp olive oil
1 tbsp lemon juice

Instructions:
1. Bring the broth to a boil.
2. Stir in the couscous and cover.
3. Rest for 5 minutes, then fluff.`,
  typical: `Smoky Weeknight Black Bean Tacos
Serves 4
Prep Time: 15 minutes
Cook Time: about 20 minutes
Total Time: 35 minutes

Ingredients:
2 tbsp olive oil
1 small yellow onion, diced
2 cloves garlic, minced
2 cans black beans, drained and rinsed
1 tsp smoked paprika
8 corn tortillas
2 cups shredded cabbage

Instructions:
1. Heat the olive oil in a skillet over medium heat.
2. Add the onion and cook until softened.
3. Stir in garlic, beans, and paprika.
4. Warm tortillas in a dry pan.
5. Fill each tortilla and serve.`,
  long: `Sunday Vegetable Lasagna
Serves 10
Prep Time: 45 minutes
Cook Time: 1 hour 15 minutes
Total Time: 2 hours

Ingredients:
2 tbsp olive oil
1 large yellow onion, diced
4 cloves garlic, minced
2 medium zucchini, sliced
1 large eggplant, diced
8 oz cremini mushrooms, sliced
1 red bell pepper, diced
2 tsp kosher salt
1 tsp black pepper
28 oz crushed tomatoes
15 oz whole-milk ricotta
12 lasagna noodles
3 cups shredded mozzarella
2 cups baby spinach

Instructions:
1. Heat the oven to 375 F.
2. Warm the olive oil in a skillet.
3. Cook the onion until translucent.
4. Add garlic and cook for 30 seconds.
5. Cook the remaining vegetables in batches.
6. Add tomatoes and simmer for 20 minutes.
7. Mix ricotta and spinach in a bowl.
8. Boil the lasagna noodles until flexible.
9. Layer noodles, filling, sauce, and mozzarella.
10. Cover and bake for 40 minutes.
11. Uncover and bake until browned.
12. Rest for 20 minutes before slicing.`,
}

const mobileCases = [
  { width: 360, height: 800, expectedTextarea: 208, recipe: recipes.simple },
  { width: 390, height: 844, expectedTextarea: 219, recipe: recipes.typical },
  { width: 430, height: 932, expectedTextarea: 220, recipe: recipes.long },
  { width: 390, height: 420, expectedTextarea: 160, recipe: recipes.typical },
]

// This local-only inspection includes isolated auth, four viewport passes,
// state-safety checks, and one real local create mutation.
test.describe.configure({ timeout: 180_000 })

async function openImport(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /add recipe/i }).first().click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: /^manual( entry)?$/i })).toHaveAttribute('data-state', 'active')
  await dialog.getByRole('tab', { name: /^import$/i }).click()
  return dialog
}

async function discardDialog(page: import('@playwright/test').Page) {
  await page.getByRole('dialog').first().getByRole('button', { name: /^close$/i }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: /^discard$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('mobile import review is compact, sectioned, and state-safe', async ({
  page,
  setupAuth,
  navigateToTab,
}, testInfo) => {
  expect(E2E_CONFIG.target).toBe('local')
  const diagnostics: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => diagnostics.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => diagnostics.push(`request: ${request.method()} ${new URL(request.url()).pathname}`))
  page.on('response', (response) => {
    if (response.status() >= 500) diagnostics.push(`response: ${response.status()} ${new URL(response.url()).pathname}`)
  })

  await page.setViewportSize({ width: 1200, height: 800 })
  await setupAuth()
  await navigateToTab('recipes')

  const measurements: Array<Record<string, unknown>> = []
  for (const mobileCase of mobileCases) {
    await page.setViewportSize(mobileCase)
    const dialog = await openImport(page)
    const source = dialog.getByLabel('Paste Recipe Text')
    await source.fill(mobileCase.recipe)
    await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toBeVisible()
    const review = dialog.getByRole('button', { name: /^review imported recipe$/i })
    await expect(review).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^add recipe$/i })).toHaveCount(0)

    const inputMetrics = await source.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]') as HTMLElement
      const tabpanel = element.closest('[role="tabpanel"]') as HTMLElement
      return {
        textareaHeight: Math.round(element.getBoundingClientRect().height),
        inputScrollerPosition: Number((tabpanel.scrollTop / tabpanel.clientHeight).toFixed(2)),
        horizontalOverflow: dialog.scrollWidth - dialog.clientWidth,
        focusedSourceVisible: document.activeElement === element &&
          element.getBoundingClientRect().top < window.innerHeight &&
          element.getBoundingClientRect().bottom > 0,
      }
    })
    expect(inputMetrics.textareaHeight).toBeGreaterThanOrEqual(mobileCase.expectedTextarea - 2)
    expect(inputMetrics.textareaHeight).toBeLessThanOrEqual(mobileCase.expectedTextarea + 2)
    expect(inputMetrics.horizontalOverflow).toBeLessThanOrEqual(1)

    await review.click()
    const reviewScroller = dialog.getByTestId('import-review-scroller')
    await expect(reviewScroller).toBeVisible()
    const detailsTraversal = await reviewScroller.evaluate((element) =>
      Number(((element.scrollHeight - element.clientHeight) / element.clientHeight).toFixed(2))
    )
    await dialog.getByRole('tab', { name: /^ingredients$/i }).click()
    const ingredientsTraversal = await reviewScroller.evaluate((element) =>
      Number(((element.scrollHeight - element.clientHeight) / element.clientHeight).toFixed(2))
    )
    const ingredientReach = await dialog.locator('input[placeholder="Ingredient"]').first().evaluate((element) => {
      const scroller = element.closest('[data-testid="import-review-scroller"]') as HTMLElement
      return Number((Math.max(0, element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom) / scroller.clientHeight).toFixed(2))
    })
    await dialog.getByRole('tab', { name: /^instructions$/i }).click()
    const instructionsTraversal = await reviewScroller.evaluate((element) =>
      Number(((element.scrollHeight - element.clientHeight) / element.clientHeight).toFixed(2))
    )
    const instructionReach = await dialog.getByLabel('Instruction group 1 step 1', { exact: true }).evaluate((element) => {
      const scroller = element.closest('[data-testid="import-review-scroller"]') as HTMLElement
      return Number((Math.max(0, element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom) / scroller.clientHeight).toFixed(2))
    })
    expect(ingredientReach).toBeLessThanOrEqual(0.5)
    expect(instructionReach).toBeLessThanOrEqual(0.5)
    await expect(dialog.getByRole('button', { name: /^back to imported text$/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save recipe$/i })).toBeVisible()
    if (mobileCase.width === 390 && mobileCase.height === 420) {
      await testInfo.attach('mobile-import-review-390x420', {
        body: await dialog.screenshot(),
        contentType: 'image/png',
      })
    }
    measurements.push({
      viewport: `${mobileCase.width}x${mobileCase.height}`,
      ...inputMetrics,
      normalizedScrollToReview: 0,
      ingredientReach,
      instructionReach,
      detailsTraversal,
      ingredientsTraversal,
      instructionsTraversal,
      totalRelevantTraversal: Number((detailsTraversal + ingredientsTraversal + instructionsTraversal).toFixed(2)),
    })
    await discardDialog(page)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  let dialog = await openImport(page)
  const source = dialog.getByLabel('Paste Recipe Text')
  await source.fill(recipes.typical)
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  const correctedName = 'Smoky Weeknight Black Bean Tacos corrected'
  await dialog.locator('#name-edit').fill(correctedName)
  await dialog.getByRole('tab', { name: /^ingredients$/i }).click()
  await dialog.locator('input[placeholder="Ingredient"]').first().fill('olive oil corrected')
  await dialog.getByRole('tab', { name: /^instructions$/i }).click()
  await dialog.getByLabel('Instruction group 1 step 1', { exact: true }).fill('Corrected first instruction.')
  await dialog.getByRole('button', { name: /^back to imported text$/i }).click()
  await expect(source).toHaveValue(recipes.typical)

  await source.fill(`${recipes.typical}\nNotes:\nReparsed source.`)
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toBeVisible()
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  const replacement = page.getByRole('alertdialog').filter({ hasText: 'Replace your draft corrections?' })
  await expect(replacement).toBeVisible()
  await replacement.getByRole('button', { name: /^keep current draft$/i }).click()
  await expect(replacement).toBeHidden()
  await expect(dialog).toBeVisible()

  await source.fill(recipes.typical)
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toBeVisible()
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  await dialog.getByRole('tab', { name: /^details$/i }).click()
  await expect(dialog.locator('#name-edit')).toHaveValue(correctedName)
  await dialog.getByRole('tab', { name: /^ingredients$/i }).click()
  await expect(dialog.locator('input[placeholder="Ingredient"]').first()).toHaveValue('olive oil corrected')
  await dialog.getByRole('tab', { name: /^instructions$/i }).click()
  await expect(dialog.getByLabel('Instruction group 1 step 1', { exact: true })).toHaveValue('Corrected first instruction.')
  await dialog.getByRole('button', { name: /^back to imported text$/i }).click()
  await source.fill(recipes.typical.replace(
    'Smoky Weeknight Black Bean Tacos',
    'Replacement Black Bean Tacos'
  ))
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toBeVisible()
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  await expect(replacement).toBeVisible()
  await replacement.getByRole('button', { name: /^replace corrections$/i }).click()
  await expect(dialog.locator('#name-edit')).toHaveValue('Replacement Black Bean Tacos')
  await discardDialog(page)

  dialog = await openImport(page)
  await dialog.getByLabel('Paste Recipe Text').fill(recipes.simple)
  await dialog.getByRole('button', { name: /^close$/i }).click()
  const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard unsaved changes?' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: /^keep editing$/i }).click()
  await expect(discard).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Paste Recipe Text')).toHaveValue(recipes.simple)
  await dialog.getByRole('button', { name: /^close$/i }).click()
  await expect(discard).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(discard).toBeHidden()
  await dialog.getByRole('button', { name: /^close$/i }).click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: /^discard$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  dialog = await openImport(page)
  const clearedSource = dialog.getByLabel('Paste Recipe Text')
  await clearedSource.fill(recipes.simple)
  await clearedSource.fill('')
  await page.waitForTimeout(400)
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^review imported recipe$/i })).toBeDisabled()
  await dialog.getByRole('button', { name: /^close$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.route('**/api/recipe-import', async (route) => {
    await route.fulfill({
      json: {
        name: 'Local URL Candidate',
        ingredients: [{ item: 'carrot', amount: 1, unit: '' }],
        instructions: ['Cook the carrot.'],
        servings: 2,
        warnings: ['Ingredient has no amount'],
      },
    })
  })
  dialog = await openImport(page)
  const importUrl = dialog.getByLabel('Import from URL')
  await importUrl.fill('https://example.com/first-recipe')
  await dialog.getByRole('button', { name: /^import$/i }).click()
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toContainText('Local URL Candidate')
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  await dialog.getByRole('button', { name: 'Ingredient has no amount' }).click()
  await expect(dialog.getByRole('tab', { name: /^ingredients$/i })).toHaveAttribute('data-state', 'active')
  await dialog.getByRole('button', { name: /^back to imported text$/i }).click()
  await importUrl.fill('https://example.com/second-recipe')
  await expect(dialog.getByRole('region', { name: 'Parsed recipe summary' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^review imported recipe$/i })).toBeDisabled()
  await discardDialog(page)
  await page.unroute('**/api/recipe-import')

  let createMutationCount = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/rest/v1/recipes')) {
      createMutationCount += 1
    }
  })
  dialog = await openImport(page)
  await dialog.getByLabel('Paste Recipe Text').fill(recipes.simple.replace('Lemon Herb Couscous', 'Mobile Import Review Save'))
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/rest/v1/recipes')
  )
  const saveRecipe = dialog.getByRole('button', { name: /^save recipe$/i })
  await saveRecipe.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  expect((await createResponse).ok()).toBe(true)
  await expect(page.getByRole('dialog').last().locator('h1').filter({ hasText: 'Mobile Import Review Save' })).toBeVisible()
  expect(createMutationCount).toBe(1)
  await page.getByRole('dialog').last().getByRole('button', { name: /^close$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  dialog = await openImport(page)
  await dialog.getByLabel('Paste Recipe Text').fill(
    recipes.simple.replace('Lemon Herb Couscous', 'Mobile Import Review Pointer Save')
  )
  await dialog.getByRole('button', { name: /^review imported recipe$/i }).click()
  const pointerCreateResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/rest/v1/recipes')
  )
  await dialog.getByRole('button', { name: /^save recipe$/i }).evaluate((button) => {
    const saveButton = button as HTMLButtonElement
    saveButton.click()
    saveButton.click()
  })
  expect((await pointerCreateResponse).ok()).toBe(true)
  await expect(page.getByRole('dialog').last().locator('h1').filter({ hasText: 'Mobile Import Review Pointer Save' })).toBeVisible()
  expect(createMutationCount).toBe(2)
  await page.getByRole('dialog').last().getByRole('button', { name: /^close$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.setViewportSize({ width: 1200, height: 800 })
  dialog = await openImport(page)
  await dialog.getByLabel('Paste Recipe Text').fill(recipes.simple)
  await expect(dialog.getByText('Ingredients Preview')).toBeVisible()
  await expect(dialog.getByText('Instructions Preview')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^apply to form$/i })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^add recipe$/i })).toHaveCount(0)
  expect(Math.round(await dialog.getByLabel('Paste Recipe Text').evaluate((element) => element.getBoundingClientRect().height))).toBe(520)
  await discardDialog(page)

  await testInfo.attach('mobile-import-review-measurements', {
    body: Buffer.from(JSON.stringify(measurements, null, 2)),
    contentType: 'application/json',
  })
  console.log(`[mobile-import-review-measurements] ${JSON.stringify(measurements)}`)
  expect(diagnostics.filter((entry) => !entry.includes('ERR_ABORTED'))).toEqual([])
})
