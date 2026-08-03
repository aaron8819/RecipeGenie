import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { Database } from '../src/types/database.generated'
import {
  MARKDOWN_TACO_SALAD_RECIPE_TEXT,
  STRUCTURED_LAMB_RECIPE_TEXT,
} from '../src/lib/__tests__/recipe-parser.fixtures'
import { parseRecipeText } from '../src/lib/recipe-parser'
import { normalizeRecipeIngredientsForSubmission } from '../src/components/recipes/recipe-dialog.defaults'
import { E2E_CONFIG } from './e2e-env'
import { expect, test } from './fixtures'

const IMPORTED_TITLE = 'Taco Salad'
const REPLACEMENT_RECIPE_UUID = '90000000-0000-4000-8000-000000000901'
const REPLACEMENT_CREATED_AT = '2024-01-02T03:04:05.000Z'
const EXPECTED_PARSED_RECIPE = parseRecipeText(
  MARKDOWN_TACO_SALAD_RECIPE_TEXT
)
const EXPECTED_INGREDIENTS = JSON.parse(
  JSON.stringify(
    normalizeRecipeIngredientsForSubmission(EXPECTED_PARSED_RECIPE.ingredients)
  )
) as RecipeRow['ingredients']
const EXPECTED_INSTRUCTIONS = EXPECTED_PARSED_RECIPE.instructions
const EXPECTED_NOTES = EXPECTED_PARSED_RECIPE.notes || []
const LEGACY_PARSED_RECIPE = parseRecipeText(STRUCTURED_LAMB_RECIPE_TEXT)
const LEGACY_TITLE = LEGACY_PARSED_RECIPE.name
const LEGACY_INSTRUCTIONS =
  LEGACY_PARSED_RECIPE.instructionGroups?.flatMap((group) => group.steps) || []
const LEGACY_NOTES = LEGACY_PARSED_RECIPE.notes || []

type RecipeRow = Database['public']['Tables']['recipes']['Row']

interface BrowserDiagnostics {
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  failedRequests: string[]
  serverErrors: string[]
  externalTargets: string[]
}

function createDiagnostics(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
    externalTargets: [],
  }

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text())
  })
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    ) {
      diagnostics.externalTargets.push(`${request.method()} ${url.origin}${url.pathname}`)
    }
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown failure'
    if (!failure.includes('ERR_ABORTED')) {
      const url = new URL(request.url())
      diagnostics.failedRequests.push(`${request.method()} ${url.pathname}: ${failure}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 500) {
      const url = new URL(response.url())
      diagnostics.serverErrors.push(`${response.status()} ${url.pathname}`)
    }
  })

  return diagnostics
}

async function assertDiagnostics(
  diagnostics: BrowserDiagnostics,
  testInfo: TestInfo
) {
  let serializedDiagnostics = JSON.stringify(diagnostics, null, 2)
  for (const secret of [
    E2E_CONFIG.email,
    E2E_CONFIG.password,
    E2E_CONFIG.supabaseAnonKey,
  ]) {
    if (secret) {
      serializedDiagnostics = serializedDiagnostics
        .split(secret)
        .join('[REDACTED]')
    }
  }
  await testInfo.attach('recipe-import-browser-diagnostics', {
    body: Buffer.from(serializedDiagnostics),
    contentType: 'application/json',
  })
  console.log(
    `[recipe-import] diagnostics: console-errors=${diagnostics.consoleErrors.length} ` +
    `console-warnings=${diagnostics.consoleWarnings.length} ` +
    `page-errors=${diagnostics.pageErrors.length} ` +
    `failed-requests=${diagnostics.failedRequests.length} ` +
    `5xx-responses=${diagnostics.serverErrors.length} ` +
    `external-targets=${diagnostics.externalTargets.length}`
  )
  expect(diagnostics.consoleErrors).toEqual([])
  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.failedRequests).toEqual([])
  expect(diagnostics.serverErrors).toEqual([])
  expect(diagnostics.externalTargets).toEqual([])
}

async function authenticatedClient(): Promise<{
  client: SupabaseClient<Database>
  userId: string
}> {
  const client = createClient<Database>(
    E2E_CONFIG.supabaseUrl,
    E2E_CONFIG.supabaseAnonKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await client.auth.signInWithPassword({
    email: E2E_CONFIG.email,
    password: E2E_CONFIG.password,
  })
  if (error || !data.user) {
    throw new Error('Local recipe import fixture authentication failed; credentials were redacted')
  }
  return { client, userId: data.user.id }
}

async function deleteRecipes(
  client: SupabaseClient<Database>,
  recipeUuids: Iterable<string>
) {
  const uniqueIds = [...new Set(recipeUuids)]
  if (uniqueIds.length === 0) return

  const { data: existing, error: lookupError } = await client
    .from('recipes')
    .select('recipe_uuid')
    .in('recipe_uuid', uniqueIds)
  if (lookupError) {
    throw new Error(`Recipe import cleanup lookup failed: ${lookupError.message}`)
  }

  for (const { recipe_uuid: recipeUuid } of existing) {
    const { error } = await client.rpc('delete_recipe', {
      p_recipe_uuid: recipeUuid,
    })
    if (error) throw new Error(`Recipe import cleanup failed: ${error.message}`)
  }

  const { data, error } = await client
    .from('recipes')
    .select('recipe_uuid')
    .in('recipe_uuid', uniqueIds)
  if (error) throw new Error(`Recipe import cleanup verification failed: ${error.message}`)
  if (data.length !== 0) throw new Error('Recipe import cleanup left recipe residue')
}

async function removePriorImportedTitle(client: SupabaseClient<Database>) {
  const { data, error } = await client
    .from('recipes')
    .select('*')
    .eq('name', IMPORTED_TITLE)
  if (error) throw new Error(`Prior recipe lookup failed: ${error.message}`)
  await deleteRecipes(
    client,
    data
      .filter((row) =>
        JSON.stringify(row.instructions) === JSON.stringify(EXPECTED_INSTRUCTIONS) &&
        JSON.stringify(row.notes) === JSON.stringify(EXPECTED_NOTES)
      )
      .map((row) => row.recipe_uuid)
  )
}

async function removePriorLegacyFixture(client: SupabaseClient<Database>) {
  const { data, error } = await client
    .from('recipes')
    .select('*')
    .eq('name', LEGACY_TITLE)
  if (error) throw new Error(`Prior legacy recipe lookup failed: ${error.message}`)
  await deleteRecipes(
    client,
    data
      .filter((row) =>
        JSON.stringify(row.instructions) === JSON.stringify(LEGACY_INSTRUCTIONS) &&
        JSON.stringify(row.notes) === JSON.stringify(LEGACY_NOTES)
      )
      .map((row) => row.recipe_uuid)
  )
}

function assertImportedRow(row: RecipeRow) {
  expect(row.name).toBe(IMPORTED_TITLE)
  expect(row.servings).toBe(4)
  expect(row.prep_time_minutes).toBe(15)
  expect(row.cook_time_minutes).toBe(10)
  expect(row.total_time_minutes).toBe(25)
  expect(row.ingredients).toHaveLength(30)
  expect(row.ingredients).toEqual(EXPECTED_INGREDIENTS)
  expect(row.instructions).toEqual(EXPECTED_INSTRUCTIONS)
  expect(row.notes).toEqual(EXPECTED_NOTES)
  expect(row.instruction_groups).toEqual([
    { steps: EXPECTED_INSTRUCTIONS },
  ])
}

async function openImportedRecipe(page: Page) {
  const search = page.getByLabel(/search recipes by name or category/i)
  await search.fill(IMPORTED_TITLE)
  const card = page.locator(`[data-recipe-name="${IMPORTED_TITLE}"]`).first()
  await expect(card).toBeVisible()
  await card.click()
  const detail = page.getByTestId('recipe-detail-page')
  await expect(detail.locator('h1')).toHaveText(IMPORTED_TITLE)
  return detail
}

async function assertImportedDetail(detail: Locator) {
  await expect(detail.locator('h1')).toHaveText(IMPORTED_TITLE, {
    timeout: 30_000,
  })
  await expect(detail.getByText('4 servings', { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('Prep 15 min', { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('Cook 10 min', { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('Total 25 min', { exact: true }).first()).toBeVisible()
  const ingredientsHeading = detail.getByRole('heading', {
    name: 'Ingredients',
    exact: true,
  })
  const ingredientsSection = ingredientsHeading.locator('xpath=ancestor::section[1]')
  const ingredientGroups = ingredientsSection.locator('[data-ingredient-group]')
  await expect(ingredientGroups).toHaveCount(3)
  await expect(ingredientGroups.nth(0)).toHaveAttribute('data-ingredient-group', 'Taco Meat')
  await expect(ingredientGroups.nth(1)).toHaveAttribute('data-ingredient-group', 'Salad')
  await expect(ingredientGroups.nth(2)).toHaveAttribute(
    'data-ingredient-group',
    'Cilantro-Lime Yogurt Dressing'
  )
  await expect(ingredientGroups.nth(0).getByRole('listitem')).toHaveCount(8)
  await expect(ingredientGroups.nth(1).getByRole('listitem')).toHaveCount(11)
  await expect(ingredientGroups.nth(2).getByRole('listitem')).toHaveCount(11)
  await expect(ingredientsSection.getByRole('listitem')).toHaveCount(30)
  await expect(detail.getByRole('heading', { name: 'Taco Meat', exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Salad', exact: true })).toBeVisible()
  await expect(
    detail.getByRole('heading', {
      name: 'Cilantro-Lime Yogurt Dressing',
      exact: true,
    })
  ).toBeVisible()
  await expect(
    detail.getByText('lean ground beef or ground turkey', { exact: true })
  ).toBeVisible()
  await expect(
    detail.getByText(
      'chopped romaine, shredded iceberg, arugula, or other greens',
      { exact: true }
    )
  ).toBeVisible()
  await expect(detail.getByText('plain Greek yogurt', { exact: true })).toBeVisible()
  for (const instruction of EXPECTED_INSTRUCTIONS) {
    await expect(detail.getByText(instruction, { exact: true })).toBeVisible()
  }
  for (const note of EXPECTED_NOTES) {
    await expect(detail.getByText(note, { exact: true })).toBeVisible()
  }
}

async function finishScenario({
  client,
  cleanup,
  diagnostics,
  label,
  testInfo,
}: {
  client: SupabaseClient<Database>
  cleanup: () => Promise<void>
  diagnostics: BrowserDiagnostics
  label: string
  testInfo: TestInfo
}) {
  const failures: unknown[] = []
  try {
    await cleanup()
    console.log(`[recipe-import] ${label} cleanup: PASS`)
  } catch (error) {
    console.error(`[recipe-import] ${label} cleanup: FAILED`)
    failures.push(error)
  }

  await client.auth.signOut({ scope: 'local' }).catch(() => undefined)

  try {
    await assertDiagnostics(diagnostics, testInfo)
  } catch (error) {
    failures.push(error)
  }

  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Recipe import ${label} cleanup and diagnostics both failed`
    )
  }
}

async function reviewMarkdownImport(dialog: Locator) {
  await dialog.getByRole('tab', { name: /^import$/i }).click()
  await dialog.getByLabel('Paste Recipe Text').fill(
    MARKDOWN_TACO_SALAD_RECIPE_TEXT
  )
  await expect(dialog.getByText(IMPORTED_TITLE, { exact: true })).toBeVisible()
  await expect(dialog.getByText('Category beef', { exact: true })).toBeVisible()
  await expect(dialog.getByText('30', { exact: true })).toBeVisible()
  await expect(dialog.getByText('11', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Ingredients Preview', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Instructions Preview', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Taco Meat', { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText('Salad', { exact: true }).first()).toBeVisible()
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.describe('local recipe import browser verification', () => {
  test('creates a persisted recipe from canonical Markdown', async ({
    page,
    setupAuth,
    navigateToRoute,
  }, testInfo) => {
    expect(E2E_CONFIG.target).toBe('local')
    expect(new URL(E2E_CONFIG.baseURL).hostname).toBe('127.0.0.1')
    expect(new URL(E2E_CONFIG.supabaseUrl).hostname).toBe('127.0.0.1')

    const diagnostics = createDiagnostics(page)
    const { client } = await authenticatedClient()
    const cleanupIds = new Set<string>()

    try {
      await removePriorImportedTitle(client)
      await setupAuth()
      await navigateToRoute('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible()
      await reviewMarkdownImport(dialog)

      await dialog.getByRole('button', { name: /^apply to form$/i }).click()
      await expect(dialog.locator('#name-add')).toHaveValue(IMPORTED_TITLE)
      await expect(dialog.getByRole('combobox').first()).toHaveText(/beef/i)
      await expect(dialog.locator('#servings-add')).toHaveValue('4')

      const createResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/rest/v1/recipes')
      )
      await dialog.getByRole('button', { name: /^add recipe$/i }).click()
      expect((await createResponse).ok()).toBe(true)

      const { data: rows, error } = await client
        .from('recipes')
        .select('*')
        .eq('name', IMPORTED_TITLE)
      if (error) throw error
      expect(rows).toHaveLength(1)
      const row = rows[0]
      cleanupIds.add(row.recipe_uuid)
      assertImportedRow(row)
      expect(row.category).toBe('beef')
      console.log('[recipe-import] create assertions: PASS')

      let detail = page.getByTestId('recipe-detail-page')
      await assertImportedDetail(detail)
      await detail.getByRole('button', { name: /^back to recipes$/i }).click()
      await expect(detail).toBeHidden()

      await page.reload()
      await navigateToRoute('recipes')
      detail = await openImportedRecipe(page)
      await assertImportedDetail(detail)
      console.log('[recipe-import] create reopen assertions: PASS')
    } finally {
      await finishScenario({
        client,
        cleanup: async () => {
          await deleteRecipes(client, cleanupIds)
          await removePriorImportedTitle(client)
        },
        diagnostics,
        label: 'create',
        testInfo,
      })
    }
  })

  test('replaces recipe content while preserving identity and metadata', async ({
    page,
    setupAuth,
    navigateToRoute,
  }, testInfo) => {
    expect(E2E_CONFIG.target).toBe('local')
    const diagnostics = createDiagnostics(page)
    const { client, userId } = await authenticatedClient()
    const cleanupIds = new Set([REPLACEMENT_RECIPE_UUID])

    try {
      await deleteRecipes(client, cleanupIds)
      const fixture = {
        id: REPLACEMENT_RECIPE_UUID,
        recipe_uuid: REPLACEMENT_RECIPE_UUID,
        user_id: userId,
        name: 'Recipe Import Replacement Fixture',
        category: 'lamb',
        servings: 2,
        favorite: true,
        tags: ['preserve-me', 'browser-fixture'],
        ingredients: [{ amount: 2, unit: 'cups', item: 'old ingredient' }],
        instructions: ['Old instruction.'],
        instruction_groups: [{ steps: ['Old instruction.'] }],
        notes: ['Old note.'],
        prep_time_minutes: 5,
        cook_time_minutes: 10,
        total_time_minutes: 15,
        image_url: null,
        created_at: REPLACEMENT_CREATED_AT,
        updated_at: REPLACEMENT_CREATED_AT,
      } satisfies Database['public']['Tables']['recipes']['Insert']
      const { error: fixtureError } = await client.from('recipes').insert(fixture)
      if (fixtureError) throw fixtureError

      await setupAuth()
      await navigateToRoute('recipes')
      const search = page.getByLabel(/search recipes by name or category/i)
      await search.fill(fixture.name)
      await page.locator(`[data-recipe-name="${fixture.name}"]`).first().click()

      const detail = page.getByTestId('recipe-detail-page')
      await expect(detail.locator('h1')).toHaveText(fixture.name)
      await expect(detail.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
      const legacyIngredientsHeading = detail.getByRole('heading', {
        name: 'Ingredients',
        exact: true,
      })
      const legacyIngredientsSection =
        legacyIngredientsHeading.locator('xpath=ancestor::section[1]')
      await expect(legacyIngredientsSection.getByRole('listitem')).toHaveCount(1)
      await expect(legacyIngredientsSection.getByRole('heading', { level: 3 })).toHaveCount(0)
      await expect(legacyIngredientsSection.getByText('old ingredient', { exact: true }))
        .toBeVisible()
      await detail.getByRole('button', { name: /edit recipe/i }).click()

      const editDialog = page.getByRole('dialog').first()
      await expect(editDialog.locator('h1')).toHaveText('Edit Recipe')
      await editDialog.getByRole('tab', { name: /^replace$/i }).click()
      await editDialog.getByLabel('Paste Updated Recipe Text').fill(
        MARKDOWN_TACO_SALAD_RECIPE_TEXT
      )
      await expect(editDialog.getByText(IMPORTED_TITLE, { exact: true })).toBeVisible()
      await expect(editDialog.getByText('Category beef', { exact: true })).toBeVisible()
      await expect(
        editDialog.getByText('Replace current recipe draft', { exact: true })
      ).toBeVisible()
      await editDialog.getByRole('button', {
        name: /^apply to current recipe$/i,
      }).click()

      await editDialog.getByRole('tab', { name: /^details$/i }).click()
      await expect(editDialog.locator('#name-edit')).toHaveValue(IMPORTED_TITLE)
      await expect(editDialog.locator('#servings-edit')).toHaveValue('4')
      const updateResponse = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/rest/v1/recipes')
      )
      await editDialog.getByRole('button', { name: /^save changes$/i }).click()
      expect((await updateResponse).ok()).toBe(true)
      await expect(editDialog).toBeHidden()

      await page.reload()
      await navigateToRoute('recipes')
      const replacedDetail = await openImportedRecipe(page)
      await assertImportedDetail(replacedDetail)
      await expect(
        replacedDetail.getByRole('button', { name: 'Remove from favorites' })
      ).toBeVisible()
      await expect(replacedDetail.getByText(/^lamb$/i)).toBeVisible()
      await expect(replacedDetail.getByText('preserve-me', { exact: true })).toBeVisible()
      await expect(
        replacedDetail.getByText('browser-fixture', { exact: true })
      ).toBeVisible()

      const { data: row, error } = await client
        .from('recipes')
        .select('*')
        .eq('recipe_uuid', REPLACEMENT_RECIPE_UUID)
        .single()
      if (error) throw error
      assertImportedRow(row)
      expect(row.id).toBe(fixture.id)
      expect(row.recipe_uuid).toBe(REPLACEMENT_RECIPE_UUID)
      expect(row.user_id).toBe(userId)
      expect(row.category).toBe(fixture.category)
      expect(row.tags).toEqual(fixture.tags)
      expect(row.favorite).toBe(fixture.favorite)
      expect(row.image_url).toBe(fixture.image_url)
      expect(new Date(row.created_at || '').toISOString()).toBe(
        REPLACEMENT_CREATED_AT
      )
      console.log('[recipe-import] replacement content assertions: PASS')
      console.log('[recipe-import] preservation assertions: PASS')
    } finally {
      await finishScenario({
        client,
        cleanup: () => deleteRecipes(client, cleanupIds),
        diagnostics,
        label: 'replacement',
        testInfo,
      })
    }
  })

  test('previews and imports a representative legacy plain-text recipe', async ({
    page,
    setupAuth,
    navigateToRoute,
  }, testInfo) => {
    expect(E2E_CONFIG.target).toBe('local')
    const diagnostics = createDiagnostics(page)
    const { client } = await authenticatedClient()
    const cleanupIds = new Set<string>()

    try {
      await removePriorLegacyFixture(client)
      await setupAuth()
      await navigateToRoute('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      const dialog = page.getByRole('dialog').first()
      await dialog.getByRole('tab', { name: /^import$/i }).click()
      await dialog.getByLabel('Paste Recipe Text').fill(
        STRUCTURED_LAMB_RECIPE_TEXT
      )
      await expect(dialog.getByText(LEGACY_TITLE, { exact: true })).toBeVisible()
      await expect(dialog.getByText('10', { exact: true })).toBeVisible()
      await expect(dialog.getByText('13', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Pan Sauce', { exact: true }).first()).toBeVisible()

      await dialog.getByRole('button', { name: /^apply to form$/i }).click()
      await expect(dialog.locator('#name-add')).toHaveValue(LEGACY_TITLE)
      const createResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/rest/v1/recipes')
      )
      await dialog.getByRole('button', { name: /^add recipe$/i }).click()
      expect((await createResponse).ok()).toBe(true)

      const { data: rows, error } = await client
        .from('recipes')
        .select('*')
        .eq('name', LEGACY_TITLE)
      if (error) throw error
      expect(rows).toHaveLength(1)
      const row = rows[0]
      cleanupIds.add(row.recipe_uuid)
      expect(row.ingredients).toHaveLength(10)
      expect(row.instructions).toEqual(LEGACY_INSTRUCTIONS)
      expect(row.notes).toEqual(LEGACY_NOTES)

      const detail = page.getByTestId('recipe-detail-page')
      await expect(detail.locator('h1')).toHaveText(LEGACY_TITLE)
      await expect(
        detail.getByText(LEGACY_NOTES[0], { exact: true })
      ).toBeVisible()
      console.log('[recipe-import] legacy preview/import assertions: PASS')
    } finally {
      await finishScenario({
        client,
        cleanup: async () => {
          await deleteRecipes(client, cleanupIds)
          await removePriorLegacyFixture(client)
        },
        diagnostics,
        label: 'legacy',
        testInfo,
      })
    }
  })
})
