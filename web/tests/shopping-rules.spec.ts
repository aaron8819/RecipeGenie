import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { E2E_CONFIG } from './e2e-env'
import { createLocalRuntime, localSupabaseEnvironment } from '../scripts/local-e2e-runtime.mjs'
import { shoppingCompatibilityFixture } from '../src/test/shopping-compatibility-fixtures'
import { createShoppingRecipeEntry, type ShoppingDocumentV3 } from '../src/lib/shopping-document'

test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test.describe.configure({ mode: 'serial' })
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Shopping rule callers preserve evidence at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    expect(E2E_CONFIG.target).toBe('local')
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107')
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
    const status = createLocalRuntime(process.cwd()).status()
    expect(status.ok).toBe(true)
    const local = localSupabaseEnvironment(status.output)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const admin = createClient(local.supabaseUrl, local.serviceRoleKey, options)
    const client = createClient(local.supabaseUrl, local.anonKey, options)
    const email = `slice5-${randomUUID()}@example.test`, password = randomUUID() + randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    expect(created.error).toBeNull()
    const owner = created.data.user!.id
    const context = await browser.newContext({ viewport, baseURL: E2E_CONFIG.baseURL })
    const page = await context.newPage()
    const diagnostics = { writes: 0, pageErrors: 0, externalRequests: 0 }
    page.on('pageerror', () => diagnostics.pageErrors++)
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.includes('/rest/v1/shopping_list') && request.method() !== 'GET') diagnostics.writes++
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) diagnostics.externalRequests++
    })
    const read = async () => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', owner).single()
      expect(result.error).toBeNull()
      return { document: result.data!.document as ShoppingDocumentV3, revision: result.data!.content_revision }
    }
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true,
        mask: [page.getByText(email, { exact: true })], animations: 'disabled' })
    }
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
      expect((await client.from('user_config').update({ onboarding_completed_at: new Date().toISOString() }).eq('user_id', owner)).error).toBeNull()
      const { document, recipes } = shoppingCompatibilityFixture()
      document.recipeEntries = {}; document.itemOverrides = {}
      for (const recipe of recipes) {
        recipe.id = randomUUID()
        expect((await client.from('recipes').insert({ id: recipe.id, recipe_uuid: recipe.id, user_id: owner,
          name: recipe.name, servings: 4, category: 'chicken', favorite: false, tags: [],
          ingredient_sections: recipe.ingredientSections, instruction_sections: recipe.instructionSections })).error).toBeNull()
        const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' })
        document.recipeEntries[recipe.id] = entry
        if (recipe.name === 'Hidden') document.itemOverrides[entry.ingredients[0].aggregateKey] = { suppressed: true }
      }
      for (const item of document.manualItems) item.id = randomUUID()
      const initial = await read()
      expect((await client.from('shopping_list').update({ document, content_revision: initial.revision + 1 })
        .eq('user_id', owner).eq('content_revision', initial.revision)).error).toBeNull()
      const saved = await read()
      await page.goto('/shopping')
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible()
      await page.goto('/shopping')
      await expect(page.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
      await capture('initial-quantities-and-order')
      expect(await read()).toEqual(saved)
      expect(diagnostics.writes).toBe(0)

      const manual = page.getByTestId('shopping-item-row').filter({ hasText: 'Added manually' }).filter({ hasText: 'lemons' })
      await manual.getByRole('button', { name: /^Actions for / }).click()
      await page.getByRole('menuitem', { name: 'Edit item', exact: true }).click()
      await page.getByLabel('Manual item amount', { exact: true }).fill('3.5')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.getByLabel('Manual item amount', { exact: true })).toHaveCount(0)
      await expect.poll(async () => (await read()).document.manualItems[0].quantity?.amount).toBe(3.5)
      await page.reload()
      await expect(manual).toContainText('3½')
      expect((await read()).document.recipeEntries).toEqual(saved.document.recipeEntries)
      expect((await read()).document.preferences).toEqual(saved.document.preferences)
      await capture('manual-extra-after-reload')

      const add = page.getByPlaceholder(viewport.width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...')
      await add.fill('yogurt'); await add.press('Enter')
      const yogurt = page.getByTestId('shopping-item-row').filter({ hasText: 'yogurt' })
      await yogurt.getByRole('button', { name: /^Actions for / }).click()
      await page.getByRole('menuitem', { name: 'Edit item', exact: true }).click()
      await page.getByLabel('Manual item name', { exact: true }).fill('lemon')
      const beforeConflict = await read(), writesBefore = diagnostics.writes
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.locator('form [role="alert"]')).toContainText('Choose a different ingredient name or cancel this edit.')
      expect(await read()).toEqual(beforeConflict)
      expect(diagnostics.writes).toBe(writesBefore)
      await capture('collision-preserves-evidence')
      expect(diagnostics.pageErrors).toBe(0); expect(diagnostics.externalRequests).toBe(0)
      await testInfo.attach('rule-evidence', { body: JSON.stringify({ viewport, diagnostics,
        realDatabase: true, interceptedResponses: false, savedOrganizationUnchanged: true }), contentType: 'application/json' })
    } finally {
      await context.close()
      await client.auth.signOut()
      expect((await admin.auth.admin.deleteUser(owner)).error).toBeNull()
    }
  })
}
