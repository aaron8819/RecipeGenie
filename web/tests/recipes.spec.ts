import {
  test,
  expect,
  reviewCreatedRecipe,
  saveReviewedRecipe,
  submitShoppingReview,
  expectShoppingSource,
} from './fixtures'
import type { Page, Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { E2E_CONFIG } from './e2e-env'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RecipeDraft = {
  name: string
  category: string
  servings: number
  ingredients: Array<{ amount: string; item: string }>
  instructions: string
}

type RecipeRunState = {
  runId: string
  recipeUuids: Set<string>
}

function captureRecipeIdentity(request: Request, state: RecipeRunState) {
  const url = request.url()
  let payload: unknown
  try {
    payload = request.postDataJSON()
  } catch {
    return
  }

  if (request.method() === 'POST' && url.includes('/rest/v1/recipes')) {
    const rows = Array.isArray(payload) ? payload : [payload]
    for (const row of rows) {
      const recipeUuid = (row as { recipe_uuid?: unknown } | null)?.recipe_uuid
      if (typeof recipeUuid === 'string' && UUID_PATTERN.test(recipeUuid)) {
        state.recipeUuids.add(recipeUuid)
      }
    }
  }
}

async function cleanupRecipeRun(state: RecipeRunState, page: Page) {
  const recipeUuids = [...state.recipeUuids]
  if (recipeUuids.length === 0) return

  const supabase = createClient(E2E_CONFIG.supabaseUrl, E2E_CONFIG.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: E2E_CONFIG.email,
    password: E2E_CONFIG.password,
  })
  if (signInError) throw signInError

  try {
    const { data: existingRecipes, error: recipeLookupError } = await supabase
      .from('recipes')
      .select('recipe_uuid')
      .in('recipe_uuid', recipeUuids)
    if (recipeLookupError) throw recipeLookupError

    for (const recipe of existingRecipes || []) {
      const operationId = randomUUID()
      const command = {
        protocol: 1,
        observedRevision: 0,
        mutation: { type: 'deleteRecipe', recipeId: recipe.recipe_uuid },
      }
      const options = { headers: { Origin: new URL(page.url()).origin } }
      const admission = await page.request.post('/api/shopping', {
        ...options,
        data: { operationId, command, phase: 'admit' },
      })
      expect(admission.ok()).toBe(true)
      const ticket = await admission.json()
      expect(ticket).toMatchObject({ status: 'Admitted', sequence: expect.any(String) })
      const execution = await page.request.post('/api/shopping', {
        ...options,
        data: { operationId, command, phase: 'execute', sequence: ticket.sequence },
      })
      expect(execution.ok()).toBe(true)
      expect(await execution.json()).toMatchObject({ status: 'Applied' })
    }

    const [recipeResult, shoppingResult] = await Promise.all([
      supabase.from('recipes').select('recipe_uuid').in('recipe_uuid', recipeUuids),
      supabase.from('shopping_list').select('document'),
    ])
    if (recipeResult.error) throw recipeResult.error
    if (shoppingResult.error) throw shoppingResult.error
    expect(recipeResult.data, `recipe cleanup failed for run ${state.runId}`).toEqual([])
    for (const row of shoppingResult.data) {
      const recipeEntries =
        (row.document as { recipeEntries?: Record<string, unknown> }).recipeEntries || {}
      for (const recipeUuid of recipeUuids) {
        expect(
          recipeEntries[recipeUuid],
          `Shopping document cleanup failed for run ${state.runId}`,
        ).toBeUndefined()
      }
    }
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}

async function expectDeletedRecipeState(recipeUuid: string, ingredient: string) {
  const supabase = createClient(E2E_CONFIG.supabaseUrl, E2E_CONFIG.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: E2E_CONFIG.email,
    password: E2E_CONFIG.password,
  })
  if (signInError) throw signInError

  try {
    const [recipeResult, shoppingResult] = await Promise.all([
      supabase.from('recipes').select('recipe_uuid').eq('recipe_uuid', recipeUuid),
      supabase.from('shopping_list').select('document'),
    ])
    if (recipeResult.error) throw recipeResult.error
    if (shoppingResult.error) throw shoppingResult.error

    expect(recipeResult.data).toEqual([])
    const document = shoppingResult.data[0]?.document as
      | {
          recipeEntries?: Record<string, unknown>
        }
      | undefined
    expect(document?.recipeEntries?.[recipeUuid]).toBeUndefined()
    expect(JSON.stringify(document?.recipeEntries || {})).not.toContain(ingredient)
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedShoppingText(value: string): RegExp {
  return new RegExp(
    value
      .split(/[\s-]+/)
      .map(escapeRegex)
      .join('[\\s-]+'),
    'i',
  )
}

function shoppingRowsByItem(page: Page, value: string) {
  return page.getByTestId('shopping-item-row').filter({
    hasText: normalizedShoppingText(value),
  })
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
  await page
    .getByRole('button', { name: /add recipe/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /^add recipe$/i })).toBeVisible()
}

async function createRecipe(page: Page, recipe: RecipeDraft) {
  await openAddRecipeDialog(page)

  const dialog = page.getByRole('dialog').first()
  await dialog.getByRole('tab', { name: 'Manual', exact: true }).click()
  await dialog.locator('#name-add').fill(recipe.name)

  await dialog.getByRole('combobox').first().click()
  await page
    .getByRole('option', { name: new RegExp(`^${escapeRegex(recipe.category)}$`, 'i') })
    .click()

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
  await reviewCreatedRecipe(page)
  await saveReviewedRecipe(page)

  await expect(page).toHaveURL(/\/recipes\/[^/?]+/)
  await expect(
    page.getByTestId('recipe-detail-page').getByRole('heading', {
      name: recipe.name,
      level: 1,
    }),
  ).toBeVisible()
}

async function returnFromRecipeDetail(page: Page) {
  await page.getByRole('button', { name: /back to recipes/i }).click()
  await expect(page.getByTestId('recipe-detail-page')).toHaveCount(0)
}

async function searchRecipes(page: Page, value: string) {
  const input = page.getByLabel(/search recipes by name or category/i)
  await input.fill(value)
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(value)
}

async function addOpenRecipeToShopping(
  page: Page,
  includeUnavailable = false,
  restoreDefaults = false,
) {
  const detailPage = page.getByTestId('recipe-detail-page')
  const button = detailPage.getByRole('button', { name: /add to shopping list/i })
  await button.click()
  if (includeUnavailable) {
    const ingredients = page.getByRole('dialog').getByRole('checkbox', { name: / ingredient \d+$/ })
    await expect(ingredients.first()).toBeVisible()
    for (const ingredient of await ingredients.all()) await ingredient.check()
  }
  await submitShoppingReview(page, restoreDefaults)
  await expect(button).toBeEnabled({ timeout: 15000 })
}

async function deleteOpenRecipe(page: Page) {
  const detailPage = page.getByTestId('recipe-detail-page')
  await expect(detailPage).toBeVisible()
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}(?:\?|$)/i)
  const recipeId = new URL(page.url()).pathname.split('/').pop()
  expect(recipeId).toMatch(UUID_PATTERN)
  await detailPage.getByRole('button', { name: /delete recipe/i }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  const deletion = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/shopping') &&
      response.request().postDataJSON()?.phase === 'execute' &&
      response.request().postDataJSON()?.command?.mutation?.type === 'deleteRecipe' &&
      response.request().postDataJSON()?.command?.mutation?.recipeId === recipeId,
  )
  await confirmation.getByRole('button', { name: /^delete$/i }).click()
  const result = await deletion
  expect(result.ok()).toBe(true)
  expect(await result.json()).toMatchObject({ status: 'Applied' })
  await expect(page).toHaveURL(/\/recipes(?:\?|$)/)
  await expect(detailPage).toHaveCount(0)
}

test.describe.configure({ mode: 'serial' })

test.describe('Recipes', () => {
  let recipeRun: RecipeRunState | undefined

  test.beforeEach(async ({ page, setupAuth, navigateToRoute }) => {
    const run: RecipeRunState = {
      runId: randomUUID(),
      recipeUuids: new Set(),
    }
    recipeRun = run
    page.on('request', (request) => captureRecipeIdentity(request, run))
    await setupAuth()
    await navigateToRoute('recipes')
  })

  test.afterEach(async ({ page }) => {
    if (recipeRun) await cleanupRecipeRun(recipeRun, page)
  })

  test('creates a recipe, finds it deterministically, opens detail, and edits the same recipe from detail @core', async ({
    page,
  }) => {
    const seed = `${Date.now()}-crud`
    const recipe = buildRecipe(seed)
    const updatedName = `Renamed Recipe ${seed}`

    await createRecipe(page, recipe)
    await expect(
      page.getByText(new RegExp(escapeRegex(recipe.ingredients[0].item), 'i')),
    ).toBeVisible()

    await returnFromRecipeDetail(page)
    await searchRecipes(page, recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()

    await page.getByText(recipe.name, { exact: true }).click()
    await expect(page).toHaveURL(/\/recipes\/[^/?]+/)
    await expect(
      page.getByTestId('recipe-detail-page').getByRole('heading', {
        name: recipe.name,
        level: 1,
      }),
    ).toBeVisible()

    await page.goBack()
    await expect(page.getByLabel(/search recipes by name or category/i)).toHaveValue(recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { name: recipe.name, level: 1 })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: recipe.name, level: 1 })).toBeVisible()

    await page.getByRole('button', { name: /edit recipe/i }).click()
    const editDialog = page.getByRole('dialog').first()
    await expect(editDialog.locator('h1').filter({ hasText: /^edit recipe$/i })).toBeVisible()
    await editDialog.locator('#name-edit').fill(updatedName)
    await editDialog.getByRole('button', { name: /save changes/i }).click()
    await expect(editDialog).toBeHidden({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: updatedName, level: 1 })).toBeVisible()
    await returnFromRecipeDetail(page)

    await searchRecipes(page, recipe.name)
    await expect(page.getByText(/no recipes match the current search and filters/i)).toBeVisible()

    await searchRecipes(page, updatedName)
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible()
  })

  test('shows recipe detail actions and adds its ingredients to shopping @extended', async ({
    page,
    navigateToRoute,
  }) => {
    const seed = `${recipeRun!.runId}-actions`
    const recipe = buildRecipe(seed)

    await createRecipe(page, recipe)

    const detailPage = page.getByTestId('recipe-detail-page')
    await expect(detailPage.getByRole('button', { name: /start cooking/i })).toHaveCount(0)
    await expect(detailPage.getByRole('button', { name: /add to shopping list/i })).toBeVisible()
    await expect(detailPage.getByRole('button', { name: /add to plan/i })).toBeVisible()
    const more = detailPage.getByRole('button', { name: 'More', exact: true })
    await more.click()
    await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(more).toBeFocused()
    await expect(detailPage.getByRole('button', { name: /edit recipe/i })).toBeVisible()
    await expect(detailPage.getByRole('button', { name: /^mark made$/i })).toBeVisible()
    await addOpenRecipeToShopping(page)

    await returnFromRecipeDetail(page)
    await page.reload()
    await navigateToRoute('recipes')
    await searchRecipes(page, recipe.name)
    await expect(page.getByText(recipe.name, { exact: true })).toBeVisible()

    await navigateToRoute('shopping')

    await expect(
      page.locator('[data-testid^="shopping-row-"]').filter({
        hasText: normalizedShoppingText(recipe.ingredients[0].item),
      }),
    ).toBeVisible()

    await expect(
      page.locator('[data-testid^="shopping-row-"]').filter({
        hasText: normalizedShoppingText(recipe.ingredients[1].item),
      }),
    ).toBeVisible()

    await shoppingRowsByItem(page, recipe.ingredients[0].item)
      .getByRole('button', { name: /^View sources for / })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: recipe.name,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(/\/recipes\/[^/?]+\?from=shopping/)
    await expect(page.getByRole('heading', { name: recipe.name, level: 1 })).toBeVisible()
  })

  test('imports pasted recipe text into an editable recipe and saves it @extended', async ({
    page,
  }) => {
    const seed = `${recipeRun!.runId}-import`
    const recipeName = `Imported E2E Recipe ${seed}`
    const ingredient = `imported ingredient ${seed}`

    await openAddRecipeDialog(page)
    const dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: 'Paste text', exact: true }).click()
    await dialog
      .getByLabel('Recipe text', { exact: true })
      .fill(
        `${recipeName}\nServes 2\n\nIngredients:\n1 cup ${ingredient}\n\nInstructions:\n1. Cook until ready.`,
      )

    await reviewCreatedRecipe(page)
    await expect(dialog.getByRole('heading', { name: recipeName, exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Edit details', exact: true }).click()
    await expect(dialog.getByLabel('Recipe Name', { exact: true })).toHaveValue(recipeName)
    await dialog.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await dialog.getByRole('button', { name: 'Edit ingredients', exact: true }).click()
    await expect(dialog.locator('input[placeholder="Ingredient"]').first()).toHaveValue(ingredient)

    await dialog.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await saveReviewedRecipe(page)
    await expect(
      page.getByTestId('recipe-detail-page').getByRole('heading', {
        name: recipeName,
        level: 1,
      }),
    ).toBeVisible()
  })

  test('preserves an imported ingredient quantity range through recipe and shopping views @extended', async ({
    page,
    navigateToRoute,
  }) => {
    const seed = `${recipeRun!.runId}-range`
    const recipeName = `Range Recipe ${seed}`
    const ingredient = `lemon zest ${seed}`

    await openAddRecipeDialog(page)
    const dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: 'Paste text', exact: true }).click()
    await dialog.getByLabel('Recipe text', { exact: true }).fill(`${recipeName}
Serves 2

Ingredients:
½–1 tsp ${ingredient}

    Instructions:
1. Mix until ready.`)

    await reviewCreatedRecipe(page)
    await dialog.getByRole('button', { name: 'Edit ingredients', exact: true }).click()
    const amountInput = dialog.locator('input[placeholder="Amt"]').first()
    await expect(amountInput).toHaveValue('½–1')
    await amountInput.fill('0.5-1')
    await amountInput.press('Tab')
    await expect(amountInput).toHaveValue('0.5-1')

    await dialog.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await saveReviewedRecipe(page)
    let detailPage = page.getByTestId('recipe-detail-page')
    await expect(detailPage.getByText('0.5-1 tsp', { exact: true })).toBeVisible()
    await expect(detailPage.getByText(ingredient, { exact: true })).toBeVisible()

    await expect(detailPage.getByRole('heading', { name: /Ingredients/ })).toBeVisible()
    await expect(detailPage.getByRole('heading', { name: 'Instructions' })).toBeVisible()
    await detailPage.getByRole('button', { name: /edit recipe/i }).click()
    const editDialog = page.getByRole('dialog').first()
    await editDialog.getByRole('tab', { name: /^ingredients$/i }).click()
    await expect(editDialog.locator('input[placeholder="Amt"]').first()).toHaveValue('0.5-1')
    await editDialog.getByRole('button', { name: /save changes/i }).click()
    await expect(editDialog).toBeHidden({ timeout: 15000 })

    await returnFromRecipeDetail(page)
    await searchRecipes(page, recipeName)
    await page.getByText(recipeName, { exact: true }).click()
    detailPage = page.getByTestId('recipe-detail-page')
    await expect(detailPage.getByText('0.5-1 tsp', { exact: true })).toBeVisible()
    await addOpenRecipeToShopping(page)
    await returnFromRecipeDetail(page)

    await navigateToRoute('shopping')
    const shoppingRow = shoppingRowsByItem(page, ingredient)
    await expect(shoppingRow).toBeVisible()
    await expectShoppingSource(page, ingredient, recipeName, /^½[–-]1 tsp\s/)
    await expect(page.getByText('½ 0.5-1 tsp', { exact: true })).toHaveCount(0)
  })

  test('replaces edited recipe contributions without stale or duplicate shopping rows @extended', async ({
    page,
    navigateToRoute,
  }) => {
    const seed = `${recipeRun!.runId}-replace`
    const originalIngredient = `e2e orzo ${seed}`
    const editedIngredient = `e2e farro ${seed}`
    const deletedIngredient = `e2e broccolini ${seed}`
    const recipe = {
      ...buildRecipe(seed),
      ingredients: [
        { amount: '1', item: originalIngredient },
        { amount: '2', item: deletedIngredient },
      ],
    }

    await createRecipe(page, recipe)
    const createdDetail = page.getByTestId('recipe-detail-page')
    await expect(createdDetail.getByText(originalIngredient, { exact: true })).toBeVisible()
    await expect(createdDetail.getByText(deletedIngredient, { exact: true })).toBeVisible()
    await addOpenRecipeToShopping(page)
    await addOpenRecipeToShopping(page)
    await returnFromRecipeDetail(page)

    await navigateToRoute('shopping')
    await expect(shoppingRowsByItem(page, originalIngredient)).toHaveCount(1)
    await expect(shoppingRowsByItem(page, deletedIngredient)).toHaveCount(1)

    await navigateToRoute('recipes')
    await searchRecipes(page, recipe.name)
    await page.getByText(recipe.name, { exact: true }).click()
    await page.getByRole('button', { name: /edit recipe/i }).click()

    const editDialog = page.getByRole('dialog').first()
    await editDialog.locator('#servings-edit').fill('8')
    await editDialog.locator('#yield-text-edit').fill('8 servings')
    await editDialog.getByRole('tab', { name: /^ingredients$/i }).click()
    await editDialog.locator('input[placeholder="Ingredient"]').first().fill(editedIngredient)
    await editDialog
      .getByRole('button', {
        name: new RegExp(`actions for ingredient 2: ${escapeRegex(deletedIngredient)}`, 'i'),
      })
      .click()
    await page.getByRole('menuitem', { name: 'Delete ingredient', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await editDialog.getByRole('button', { name: /save changes/i }).click()
    await expect(editDialog).toBeHidden({ timeout: 15000 })

    await returnFromRecipeDetail(page)
    await searchRecipes(page, recipe.name)
    await page.getByText(recipe.name, { exact: true }).click()
    const detailPage = page.getByTestId('recipe-detail-page')
    await expect(
      detailPage.getByRole('button', { name: 'Adjust yield', exact: true }),
    ).toContainText('8 servings')
    await addOpenRecipeToShopping(page)
    await returnFromRecipeDetail(page)

    await navigateToRoute('shopping')
    await expect(shoppingRowsByItem(page, editedIngredient)).toHaveCount(1)
    await expect(shoppingRowsByItem(page, originalIngredient)).toHaveCount(0)
    await expect(shoppingRowsByItem(page, deletedIngredient)).toHaveCount(0)

    await page.reload()
    await expect(shoppingRowsByItem(page, editedIngredient)).toHaveCount(1)
    await expect(shoppingRowsByItem(page, originalIngredient)).toHaveCount(0)
    await expect(shoppingRowsByItem(page, deletedIngredient)).toHaveCount(0)

    await navigateToRoute('recipes')
    await searchRecipes(page, recipe.name)
    await page.getByText(recipe.name, { exact: true }).click()
    await deleteOpenRecipe(page)
    await navigateToRoute('shopping')
    await expect(shoppingRowsByItem(page, editedIngredient)).toHaveCount(0)
  })

  test('deletes an active recipe contribution through one visible confirmation @smoke', async ({
    page,
    navigateToRoute,
  }) => {
    const seed = `${Date.now()}-delete`
    const recipe = {
      ...buildRecipe(seed),
      ingredients: [{ amount: '1', item: `delete ingredient ${seed}` }],
    }
    let nativeConfirmCount = 0
    const identityWrites: Request[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (
        url.includes('/rest/v1/recipes') ||
        url.includes('/rest/v1/shopping_list') ||
        url.endsWith('/api/shopping')
      ) {
        identityWrites.push(request)
      }
    })
    page.on('dialog', async (dialog) => {
      nativeConfirmCount += 1
      await dialog.dismiss()
    })

    await createRecipe(page, recipe)
    const detailPage = page.getByTestId('recipe-detail-page')
    await addOpenRecipeToShopping(page)

    await detailPage.getByRole('button', { name: /delete recipe/i }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    const confirmButton = confirmation.getByRole('button', { name: /^delete$/i })
    await expect(confirmButton).toBeVisible()
    await expect(confirmButton).toBeEnabled()

    const recipeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/shopping') &&
        response.request().postDataJSON()?.phase === 'execute' &&
        response.request().postDataJSON()?.command?.mutation?.type === 'deleteRecipe',
    )

    await confirmButton.click()
    const recipeResult = await recipeResponse

    expect(recipeResult.ok()).toBe(true)
    expect(await recipeResult.json()).toMatchObject({ status: 'Applied' })
    const recipeCreate = identityWrites.find(
      (request) => request.method() === 'POST' && request.url().includes('/rest/v1/recipes'),
    )
    const shoppingWrites = identityWrites.filter(
      (request) =>
        request.url().endsWith('/api/shopping') &&
        request.postDataJSON()?.phase === 'execute' &&
        request.postDataJSON()?.command?.mutation?.type === 'upsertRecipes',
    )
    const recipeDelete = identityWrites.find(
      (request) =>
        request.url().endsWith('/api/shopping') &&
        request.postDataJSON()?.phase === 'execute' &&
        request.postDataJSON()?.command?.mutation?.type === 'deleteRecipe',
    )
    expect(recipeCreate).toBeDefined()
    expect(recipeDelete).toBeDefined()
    expect(shoppingWrites).toHaveLength(1)
    expect(
      identityWrites.filter(
        (request) =>
          request.url().includes('/rest/v1/shopping_list') &&
          ['POST', 'PATCH', 'DELETE'].includes(request.method()),
      ),
    ).toHaveLength(0)

    const createPayload = recipeCreate?.postDataJSON() as Record<string, unknown>
    expect(createPayload.recipe_uuid).toEqual(expect.stringMatching(UUID_PATTERN))
    expect(createPayload.id).toBe(createPayload.recipe_uuid)

    const shoppingPayload = shoppingWrites[0].postDataJSON() as {
      command: { mutation: { entries: Array<{ recipeId: string }> } }
    }
    expect(shoppingPayload.command.mutation.entries).toEqual([
      expect.objectContaining({ recipeId: createPayload.recipe_uuid }),
    ])

    const deletePayload = recipeDelete?.postDataJSON() as Record<string, unknown>
    expect(deletePayload.command).toMatchObject({
      mutation: { type: 'deleteRecipe', recipeId: createPayload.recipe_uuid },
    })
    await expectDeletedRecipeState(createPayload.recipe_uuid as string, recipe.ingredients[0].item)
    expect(nativeConfirmCount).toBe(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await searchRecipes(page, recipe.name)
    await expect(page.getByText(/no recipes match the current search and filters/i)).toBeVisible()

    await navigateToRoute('shopping')
    await expect(page.getByText(recipe.ingredients[0].item, { exact: true })).toHaveCount(0)
  })

  test('preserves supported pantry and exclusion lifecycle actions across replacement @smoke', async ({
    page,
    navigateToRoute,
  }) => {
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
    await returnFromRecipeDetail(page)
    await navigateToRoute('shopping')

    const pantryRow = shoppingRowsByItem(page, pantryRecipe.ingredients[0].item)
    const pantryResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/shopping') &&
        response.request().postDataJSON()?.phase === 'execute' &&
        response.request().postDataJSON()?.command?.mutation?.type === 'pantry',
    )
    await pantryRow.getByRole('button', { name: /^actions for /i }).click()
    await page.getByRole('menuitem', { name: /add to pantry/i }).click()
    const pantryResult = await pantryResponse
    expect(pantryResult.ok()).toBe(true)
    expect(await pantryResult.json()).toMatchObject({ status: 'Applied' })
    const pantryRestore = page.getByRole('button', {
      name: normalizedShoppingText(`Restore ${pantryRecipe.ingredients[0].item}`),
    })
    await expect(pantryRestore).toBeVisible()
    await pantryRestore.click()
    await expect(pantryRow).toBeVisible()

    await navigateToRoute('recipes')
    await searchRecipes(page, pantryRecipe.name)
    await page.getByText(pantryRecipe.name, { exact: true }).click()
    await addOpenRecipeToShopping(page)
    await returnFromRecipeDetail(page)
    await navigateToRoute('shopping')
    await expect(pantryRestore).toHaveCount(0)
    await expect(pantryRow).toBeVisible()
    await page.reload()
    await expect(pantryRow).toBeVisible()

    await navigateToRoute('pantry')
    const removePantryButton = page.getByRole('button', {
      name: normalizedShoppingText(`Actions for ${pantryRecipe.ingredients[0].item}`),
    })
    await removePantryButton.click()
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
    await expect(removePantryButton).toHaveCount(0)

    const excludedInput = page.getByPlaceholder(/add excluded keyword \(comma-separated\)/i)
    await excludedInput.fill(exclusionRecipe.ingredients[0].item)
    await page.keyboard.press('Enter')
    await expect(page.getByText(exclusionRecipe.ingredients[0].item, { exact: true })).toBeVisible()

    await navigateToRoute('recipes')
    await createRecipe(page, exclusionRecipe)
    await addOpenRecipeToShopping(page, true, true)
    await returnFromRecipeDetail(page)
    await navigateToRoute('shopping')
    const excludedRestore = page.getByRole('button', {
      name: normalizedShoppingText(`Restore ${exclusionRecipe.ingredients[0].item}`),
    })
    await expect(excludedRestore).toBeVisible()
    await excludedRestore.click()
    const excludedRow = shoppingRowsByItem(page, exclusionRecipe.ingredients[0].item)
    await expect(excludedRow).toBeVisible()

    await navigateToRoute('recipes')
    await searchRecipes(page, exclusionRecipe.name)
    await page.getByText(exclusionRecipe.name, { exact: true }).click()
    await addOpenRecipeToShopping(page, true)
    await returnFromRecipeDetail(page)
    await navigateToRoute('shopping')
    await expect(excludedRestore).toHaveCount(0)
    await expect(excludedRow).toBeVisible()
    await page.reload()
    await expect(excludedRow).toBeVisible()

    await navigateToRoute('pantry')
    await page
      .getByRole('button', {
        name: `Actions for ${exclusionRecipe.ingredients[0].item}`,
        exact: true,
      })
      .click()
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
    await navigateToRoute('recipes')

    for (const recipe of [pantryRecipe, exclusionRecipe]) {
      await searchRecipes(page, recipe.name)
      await page.getByText(recipe.name, { exact: true }).click()
      await deleteOpenRecipe(page)
    }
  })
})
