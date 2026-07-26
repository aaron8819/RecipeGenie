import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { Database } from '../src/types/database.generated'
import { MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT } from '../src/lib/__tests__/recipe-parser.fixtures'
import { E2E_CONFIG } from './e2e-env'
import { expect, test } from './fixtures'

const IMPORTED_TITLE = 'Sesame Chicken'
const REPLACEMENT_RECIPE_UUID = '90000000-0000-4000-8000-000000000901'
const REPLACEMENT_CREATED_AT = '2024-01-02T03:04:05.000Z'
const SERVINGS_WARNING =
  'Servings range "4–5" will be saved as 4 because Recipe Genie stores one serving count.'
const MULTILINE_INSTRUCTION =
  'Rest the chicken for two minutes. Keep the skillet uncovered so the coating stays crisp.'
const EXPECTED_INGREDIENTS = [
  {
    amount: 1.5,
    unit: 'lb',
    item: 'boneless, skinless chicken thighs',
    groupLabel: 'Chicken',
    originalText: '1½ lb boneless, skinless chicken thighs, cut into 1-inch pieces',
    displayText: 'boneless, skinless chicken thighs, cut into 1-inch pieces',
  },
  {
    amount: 0.75,
    unit: 'tsp',
    item: 'kosher salt',
    groupLabel: 'Chicken',
    originalText: '¾ tsp kosher salt',
    displayText: 'kosher salt',
  },
  {
    amount: 0.375,
    unit: 'tsp',
    item: 'black pepper',
    groupLabel: 'Chicken',
    originalText: '⅜ tsp black pepper',
    displayText: 'black pepper',
  },
  {
    amount: 0.25,
    unit: 'cup',
    item: 'low-sodium soy sauce',
    groupLabel: 'Sesame Sauce',
    originalText: '¼ cup low-sodium soy sauce',
    displayText: 'low-sodium soy sauce',
  },
  {
    amount: 0.25,
    unit: 'cup',
    item: 'honey',
    groupLabel: 'Sesame Sauce',
    originalText: '¼ cup honey',
    displayText: 'honey',
  },
  {
    amount: 1,
    unit: 'tbsp',
    item: 'toasted sesame oil',
    groupLabel: 'Sesame Sauce',
    originalText: '1 tbsp toasted sesame oil',
    displayText: 'toasted sesame oil',
  },
  {
    amount: '0.5–1',
    unit: 'tsp',
    item: 'red pepper flakes',
    groupLabel: 'Sesame Sauce',
    originalText: '½–1 tsp red pepper flakes',
    displayText: 'red pepper flakes',
  },
]
const EXPECTED_INSTRUCTIONS = [
  'Cook the rice according to package directions.',
  'Season the chicken with kosher salt and black pepper.',
  'Whisk the soy sauce, honey, and sesame oil together.',
  'Heat a large skillet over medium-high heat.',
  'Add the chicken in a single layer.',
  'Brown the first side without moving the pieces.',
  'Turn the chicken and cook the second side.',
  'Reduce the heat to medium.',
  'Pour the sauce into the skillet.',
  'Stir until every piece is coated.',
  'Simmer until the sauce thickens.',
  'Check that the chicken is cooked through.',
  'Remove the skillet from the heat.',
  MULTILINE_INSTRUCTION,
  'Spoon the chicken over rice.',
  'Garnish with sesame seeds and serve.',
]
const EXPECTED_NOTES = [
  'Keep the frying oil close to 350°F.',
  'Sauce the chicken immediately before serving.',
]

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

function assertImportedRow(row: RecipeRow) {
  expect(row.name).toBe(IMPORTED_TITLE)
  expect(row.servings).toBe(4)
  expect(row.prep_time_minutes).toBe(20)
  expect(row.cook_time_minutes).toBe(25)
  expect(row.total_time_minutes).toBe(45)
  expect(row.ingredients).toHaveLength(7)
  expect(row.ingredients).toEqual(
    EXPECTED_INGREDIENTS.map(({ displayText: _displayText, ...ingredient }) =>
      expect.objectContaining(ingredient)
    )
  )
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
  const detail = page.getByRole('dialog').last()
  await expect(detail.locator('h1')).toHaveText(IMPORTED_TITLE)
  return detail
}

async function assertImportedDetail(detail: Locator) {
  await expect(detail.getByText('4 servings', { exact: true })).toBeVisible()
  await expect(detail.getByText('Prep 20 min', { exact: true })).toBeVisible()
  await expect(detail.getByText('Cook 25 min', { exact: true })).toBeVisible()
  await expect(detail.getByText('Total 45 min', { exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Chicken', exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Sesame Sauce', exact: true })).toBeVisible()
  for (const ingredient of EXPECTED_INGREDIENTS) {
    await expect(
      detail.getByText(ingredient.displayText, { exact: true })
    ).toBeVisible()
  }
  for (const instruction of EXPECTED_INSTRUCTIONS) {
    await expect(detail.getByText(instruction, { exact: true })).toBeVisible()
  }
  await expect(detail.getByText(EXPECTED_NOTES[0], { exact: true })).toBeVisible()
  await expect(detail.getByText(EXPECTED_NOTES[1], { exact: true })).toBeVisible()
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
    MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT
  )
  await expect(dialog.getByText(IMPORTED_TITLE, { exact: true })).toBeVisible()
  await expect(dialog.getByText(SERVINGS_WARNING, { exact: true })).toBeVisible()
  await expect(dialog.getByText('Ingredients Preview', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Instructions Preview', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Chicken', { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText('Sesame Sauce', { exact: true }).first()).toBeVisible()
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.describe('local recipe import browser verification', () => {
  test('creates a persisted recipe from canonical Markdown', async ({
    page,
    setupAuth,
    navigateToTab,
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
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible()
      await reviewMarkdownImport(dialog)

      await dialog.getByRole('button', { name: /^apply to form$/i }).click()
      await expect(dialog.locator('#name-add')).toHaveValue(IMPORTED_TITLE)
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
      console.log('[recipe-import] create assertions: PASS')

      let detail = page.getByRole('dialog').last()
      await assertImportedDetail(detail)
      await detail.getByRole('button', { name: /^close$/i }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.reload()
      await navigateToTab('recipes')
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
    navigateToTab,
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
      await navigateToTab('recipes')
      const search = page.getByLabel(/search recipes by name or category/i)
      await search.fill(fixture.name)
      await page.locator(`[data-recipe-name="${fixture.name}"]`).first().click()

      const detail = page.getByRole('dialog').last()
      await expect(detail.locator('h1')).toHaveText(fixture.name)
      await expect(detail.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
      await detail.getByRole('button', { name: /edit recipe/i }).click()

      const editDialog = page.getByRole('dialog').first()
      await expect(editDialog.locator('h1')).toHaveText('Edit Recipe')
      await editDialog.getByRole('tab', { name: /^replace$/i }).click()
      await editDialog.getByLabel('Paste Updated Recipe Text').fill(
        MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT
      )
      await expect(editDialog.getByText(IMPORTED_TITLE, { exact: true })).toBeVisible()
      await expect(editDialog.getByText(SERVINGS_WARNING, { exact: true })).toBeVisible()
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
      await navigateToTab('recipes')
      const replacedDetail = await openImportedRecipe(page)
      await assertImportedDetail(replacedDetail)
      await expect(
        replacedDetail.getByRole('button', { name: 'Remove from favorites' })
      ).toBeVisible()
      await expect(replacedDetail.getByText('lamb', { exact: true })).toBeVisible()
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
})
