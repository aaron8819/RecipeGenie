import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { E2E_CONFIG } from './e2e-env'
import { createLocalRuntime, localSupabaseEnvironment } from '../scripts/local-e2e-runtime.mjs'
import { canonicalizeRecipeFixture } from '../src/test/recipe-fixtures'
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument,
  type ShoppingDocumentV3 } from '../src/lib/shopping-document'
import { shoppingRecipeSelections } from '../src/lib/shopping-sources'
import { parseQuantityV1 } from '../src/lib/recipe-quantity'

test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test.describe.configure({ mode: 'serial' })

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Shopping sources and recovery at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    expect(E2E_CONFIG.target).toBe('local')
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107')
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
    const status = createLocalRuntime(process.cwd()).status()
    expect(status.ok, 'requires existing loopback Supabase; never reset shared fixtures').toBe(true)
    const local = localSupabaseEnvironment(status.output)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const admin = createClient(local.supabaseUrl, local.serviceRoleKey, options)
    const client = createClient(local.supabaseUrl, local.anonKey, options)
    const email = `slice4-${randomUUID()}@example.test`
    const password = randomUUID() + randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    expect(created.error).toBeNull()
    const owner = created.data.user!.id
    const context = await browser.newContext({ viewport, baseURL: E2E_CONFIG.baseURL })
    const page = await context.newPage()
    const diagnostics = { pageErrors: 0, externalRequests: 0, shoppingWrites: 0 }
    page.on('pageerror', () => diagnostics.pageErrors++)
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) diagnostics.externalRequests++
      if (url.pathname.includes('/rest/v1/shopping_list') && request.method() !== 'GET') diagnostics.shoppingWrites++
    })
    const read = async () => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', owner).single()
      expect(result.error).toBeNull()
      return { document: result.data!.document as ShoppingDocumentV3, revision: result.data!.content_revision as number }
    }
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled',
        mask: [page.getByText(email, { exact: true })] })
    }
    const expandRecipes = async () => {
      await expect(page.getByTestId('shopping-recipe-context')).toBeVisible()
      const expand = page.getByRole('button', { name: 'Show recipes in list', exact: true })
      if (await expand.isVisible()) await expand.click()
    }
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
      expect((await client.from('user_config').update({ onboarding_completed_at: new Date().toISOString() }).eq('user_id', owner)).error).toBeNull()
      const document = createEmptyShoppingDocument()
      const fixtures = [ ['Soup', 'carrot'], ['Soup', 'carrot'], ['Manual', 'onion'],
        ['In Pantry', 'rice'], ['Excluded', 'cumin'], ['Hidden', 'lime'], ['Completed', 'pepper'], ['Empty', ''] ]
      for (const [index, [name, ingredient]] of fixtures.entries()) {
        const ingredients = ingredient ? [{ item: ingredient, amount: '1–2', unit: '', quantityV1: parseQuantityV1('1–2')! }] : []
        if (index === 0) ingredients.push(structuredClone(ingredients[0]))
        const id = randomUUID()
        const recipe = canonicalizeRecipeFixture({ id, name, fixtureIngredients: ingredients })
        expect((await client.from('recipes').insert({ id, recipe_uuid: id, user_id: owner, name,
          category: 'chicken', servings: 4, favorite: false, tags: [],
          ingredient_sections: recipe.ingredientSections,
          instruction_sections: [{ label: null, steps: [`Prepare ${ingredient || 'dish'}.`] }],
        })).error).toBeNull()
        document.recipeEntries[id] = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' })
      }
      const entries = Object.values(document.recipeEntries)
      const rows = projectShoppingDocument(document).rows
      document.itemOverrides[rows.find(row => row.displayName === 'lime')!.aggregateKey!] = { suppressed: true }
      document.itemOverrides[rows.find(row => row.displayName === 'pepper')!.aggregateKey!] = { checked: true }
      document.preferences.excludedIngredientKeys = ['cumin']
      document.preferences.categoryOrder = ['dairy', 'produce']
      const unknownCategory = `custom_${randomUUID()}`
      for (const [index, name] of ['orphan bread', 'orphan oats', 'orphan rice', 'orphan cumin'].entries()) {
        document.manualItems.push({ id: randomUUID(), displayName: name, quantity: { amount: 2, unit: '' },
          categoryKey: unknownCategory, bucket: index === 2 ? 'already_have' : index === 3 ? 'excluded' : 'items', checked: index === 1 })
      }
      expect((await client.from('pantry_items').insert({ user_id: owner, item: 'rice' })).error).toBeNull()
      const initial = await read()
      expect((await client.from('shopping_list').update({ document, content_revision: initial.revision + 1 })
        .eq('user_id', owner).eq('content_revision', initial.revision)).error).toBeNull()
      const savedRecipes = await client.from('recipes').select('recipe_uuid,ingredient_sections').eq('user_id', owner).order('recipe_uuid')
      expect(savedRecipes.error).toBeNull()
      await page.goto('/shopping')
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible()
      await page.goto('/shopping')
      await expandRecipes()
      const panel = page.getByTestId('shopping-recipe-context')
      await expect(panel.getByRole('button', { name: /^Remove all items from / })).toHaveCount(8)
      const selections = shoppingRecipeSelections(document.recipeEntries)
      for (const source of selections.filter(entry => entry.recipeName === 'Soup' || entry.recipeName === 'Manual')) {
        const control = panel.getByRole('button', { name: `View ${source.label}`, exact: true })
        await control.focus(); await page.keyboard.press('Enter')
        await expect(page).toHaveURL(new RegExp(`/recipes/${source.recipeId}\\?from=shopping$`))
        await page.goBack(); await expandRecipes()
      }
      await expect(page.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
      const fallback = page.getByTestId('shopping-category-__unknown_category__')
      await expect(fallback.getByText('orphan breads', { exact: true })).toBeVisible()
      await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'orphan bread' })).toHaveCount(1)
      expect((await read()).document.manualItems).toEqual(document.manualItems)
      await capture('sources-and-fallback')
      const fallbackHeader = fallback.getByRole('button').filter({ hasText: 'Other items — category unavailable' }).first()
      await fallbackHeader.focus(); await page.keyboard.press('Enter')
      await expect(fallbackHeader).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Enter')
      await expect(fallbackHeader).toHaveAttribute('aria-expanded', 'true')

      // Unavailable recipe response is browser-only; the saved selection remains real.
      const manualRecipe = entries.find(entry => entry.recipeName === 'Manual')!
      await page.route('**/rest/v1/recipes*', route => {
        if (route.request().url().includes(`eq.${manualRecipe.recipeId}`)) return route.fulfill({ status: 406,
          contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'No rows' }) })
        return route.continue()
      })
      await panel.getByRole('button', { name: 'View Manual', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/recipes/${manualRecipe.recipeId}`))
      await page.reload()
      await expect(page.getByText('Recipe not found', { exact: true })).toBeVisible({ timeout: 20_000 })
      await page.goBack(); await page.unroute('**/rest/v1/recipes*'); await expandRecipes()
      expect((await read()).document.recipeEntries[manualRecipe.recipeId]).toEqual(manualRecipe)

      for (const selected of [selections.find(entry => entry.label === 'Soup (2)')!,
        selections.find(entry => entry.recipeName === 'In Pantry')!,
        selections.find(entry => entry.recipeName === 'Hidden')!,
        selections.find(entry => entry.recipeName === 'Manual')!]) {
        const before = await read()
        await panel.getByRole('button', { name: `Remove all items from ${selected.label}`, exact: true }).click()
        await expect.poll(async () => Object.keys((await read()).document.recipeEntries)).not.toContain(selected.recipeId)
        const after = await read()
        for (const entry of Object.values(before.document.recipeEntries)) {
          if (entry.recipeId !== selected.recipeId) expect(after.document.recipeEntries[entry.recipeId]).toEqual(entry)
        }
        expect(after.document.manualItems).toEqual(before.document.manualItems)
        expect(after.document.preferences).toEqual(before.document.preferences)
        await page.reload(); await expandRecipes()
        await expect(panel.getByRole('button', { name: `View ${selected.label}`, exact: true })).toHaveCount(0)
      }
      await expect(panel.getByRole('button', { name: 'View Empty', exact: true })).toBeVisible()
      await expect(panel.getByRole('button', { name: 'View Completed', exact: true })).toBeVisible()
      await capture('after-removal-reload')

      // Both category partitions preserve unknown references and actions on reload.
      const done = page.getByRole('button', { name: /^Show \d+ done$/ })
      if (await done.isVisible()) await done.click()
      await expect(fallback.getByText('orphan oats', { exact: true })).toBeVisible()
      for (const name of ['Expand pantry items', 'Expand excluded items']) {
        const button = page.getByRole('button', { name, exact: true })
        if (await button.isVisible()) await button.click()
      }
      await expect(page.getByRole('button', { name: /^Restore orphan rice/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Restore orphan cumin/ })).toBeVisible()
      const orphan = fallback.getByRole('button', { name: 'Check off orphan breads', exact: true })
      await orphan.focus(); await page.keyboard.press('Enter')
      await expect.poll(async () => (await read()).document.manualItems.find(item => item.displayName === 'orphan bread')?.checked).toBe(true)
      await page.reload()
      expect((await read()).document.manualItems.every(item => item.categoryKey === unknownCategory)).toBe(true)

      const beforeFailures = await read()
      const writesBeforeFailures = diagnostics.shoppingWrites
      for (const failure of ['shopping', 'unsupported', 'malformed', 'pantry']) {
        const pattern = failure === 'pantry' ? '**/rest/v1/pantry_items*' : '**/rest/v1/shopping_list*'
        let failing = true
        await page.route(pattern, route => {
          if (!failing || route.request().method() !== 'GET') return route.continue()
          if (failure === 'unsupported' || failure === 'malformed') return route.fulfill({ status: 200,
            contentType: 'application/json', body: JSON.stringify({ document: failure === 'unsupported'
              ? { schemaVersion: 999 } : { ...beforeFailures.document, manualItems: 'invalid' }, content_revision: beforeFailures.revision }) })
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Read unavailable' }) })
        })
        await page.reload()
        const message = failure === 'pantry' ? 'Couldn’t load pantry items. Try again.' : failure === 'shopping'
          ? 'Couldn’t load your shopping list. Try again.' : 'This shopping list could not be opened. Your saved list has not been changed.'
        await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByText('Your shopping list is clear', { exact: true })).toHaveCount(0)
        if (failure === 'pantry') {
          await expandRecipes()
          await expect(panel.getByRole('button', { name: 'Remove all items from Empty', exact: true })).toBeEnabled()
          await expect(page.getByTestId('shopping-item-row')).toHaveCount(0)
          await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeDisabled()
        } else await expect(page.getByRole('button', { name: 'Add item', exact: true })).toHaveCount(0)
        await capture(`initial-${failure}`)
        expect(await read()).toEqual(beforeFailures)
        failing = false
        const retry = page.getByRole('button', { name: 'Try again', exact: true })
        await retry.focus(); await page.keyboard.press('Enter')
        await expect(page.getByText(message, { exact: true })).toHaveCount(0)
        await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'carrot' })).toHaveCount(1)
        expect(await read()).toEqual(beforeFailures)
        await page.unroute(pattern)
      }

      // Cached dependency failures: remount the route with stale queries while
      // retaining the authenticated QueryClient. Browser time advances only.
      for (const [index, dependency] of ['shopping_list', 'pantry_items'].entries()) {
        const pattern = `**/rest/v1/${dependency}*`
        await page.route(pattern, route => route.request().method() === 'GET'
          ? route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Read unavailable"}' }) : route.continue())
        await page.getByRole('link', { name: 'Go to Planner', exact: true }).click()
        await expect(page).toHaveURL(/\/planner$/)
        await page.clock.setFixedTime(new Date(Date.now() + 120_000 * (index + 1)))
        await page.getByRole('link', { name: 'Shopping', exact: true }).click()
        await expect(page).toHaveURL(/\/shopping$/)
        await expect(page.getByText(dependency === 'shopping_list'
          ? 'Couldn’t refresh your shopping list. Showing the last loaded list.'
          : 'Couldn’t refresh pantry items. Showing the last loaded availability.', { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'carrot' })).toHaveCount(1)
        if (dependency === 'shopping_list') {
          await expect(page.getByRole('button', { name: 'Check off carrot', exact: true })).toBeDisabled()
          await expandRecipes()
          await expect(panel.getByRole('button', { name: 'View Empty', exact: true })).toBeEnabled()
        }
        await capture(`cached-${dependency}`)
        await page.unroute(pattern)
        await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect(page.getByText(/Couldn’t refresh/)).toHaveCount(0)
      }
      expect(diagnostics.shoppingWrites).toBe(writesBeforeFailures)
      expect(await read()).toEqual(beforeFailures)
      const recipesAfter = await client.from('recipes').select('recipe_uuid,ingredient_sections').eq('user_id', owner).order('recipe_uuid')
      expect(recipesAfter.data).toEqual(savedRecipes.data)
      expect(diagnostics.pageErrors).toBe(0)
      expect(diagnostics.externalRequests).toBe(0)
      await capture('recovered')
      await testInfo.attach('scenario-evidence', { body: JSON.stringify({ viewport, diagnostics,
        persistedSources: true, hiddenRemoval: true, preservedUnknownReferences: true,
        unsupportedAndMissingRecipeResponses: 'browser-only fixtures', recoveryWrites: 0 }), contentType: 'application/json' })
    } finally {
      await context.close()
      expect((await admin.auth.admin.deleteUser(owner)).error).toBeNull()
    }
  })
}
