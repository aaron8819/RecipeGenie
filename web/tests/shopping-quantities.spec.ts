import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { parseQuantityV1 } from '../src/lib/recipe-quantity'
import type { Ingredient } from '../src/types/database'
import type { ShoppingDocumentV3 } from '../src/lib/shopping-document'
import { E2E_CONFIG } from './e2e-env'
import { createLocalRuntime, localSupabaseEnvironment } from '../scripts/local-e2e-runtime.mjs'

// Fresh disposable owners only. Never bootstrap/reset shared fixtures. Auth
// contexts do not save state, traces or videos; screenshots mask owner text.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test.describe.configure({ mode: 'serial' })

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`lossless Shopping quantities at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    expect(E2E_CONFIG.target).toBe('local')
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107')
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
    const status = createLocalRuntime(process.cwd()).status()
    expect(status.ok, 'requires existing loopback Supabase').toBe(true)
    const local = localSupabaseEnvironment(status.output)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const admin = createClient(local.supabaseUrl, local.serviceRoleKey, options)
    const client = createClient(local.supabaseUrl, local.anonKey, options)
    const email = `slice3-${randomUUID()}@example.test`
    const password = randomUUID() + randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    expect(created.error).toBeNull()
    const owner = created.data.user!.id
    const context = await browser.newContext({ viewport, baseURL: E2E_CONFIG.baseURL,
      permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    const diagnostics = { pageErrors: 0, externalRequests: 0 }
    page.on('pageerror', () => diagnostics.pageErrors++)
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) diagnostics.externalRequests++
    })
    const read = async () => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', owner).single()
      expect(result.error).toBeNull()
      return { document: result.data!.document as ShoppingDocumentV3, revision: result.data!.content_revision as number }
    }
    const capture = async (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`),
      fullPage: true, mask: [page.getByText(email, { exact: true })] })
    const range = (item: string): Ingredient => ({ item, amount: '1–2', unit: '', quantityV1: parseQuantityV1('1–2') })
    const pack = (size: number): Ingredient => ({ item: 'beans', amount: 1, unit: `can (${size} oz)`,
      quantityV1: parseQuantityV1('1'), authoredUnit: `can (${size} oz)`,
      packageV1: { version: 1, count: parseQuantityV1('1'), type: 'can', authoredType: 'can',
        size: { value: { numerator: String(size), denominator: '1' }, lexeme: String(size), unit: 'oz', authoredUnit: 'oz' } } })
    const ingredients: Ingredient[] = [range('carrot'), range('carrot'),
      { item: 'flour', amount: 2, unit: 'cup' }, { item: 'flour', amount: null, unit: '', modifier: 'as needed' },
      { item: 'flour', amount: null, unit: '' },
      { item: 'onion', amount: 2, unit: 'count' }, { item: 'onion', amount: 100, unit: 'g' },
      pack(14), pack(14), pack(28),
      { item: 'milk', amount: '1/3', unit: 'cup', quantityV1: parseQuantityV1('1/3') },
      { item: 'milk', amount: '1/3', unit: 'cup', quantityV1: parseQuantityV1('1/3') },
      range('rice'), range('rice'), range('cumin'), range('cumin')]
    const recipeIds = [randomUUID(), randomUUID()]
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
      expect((await client.from('user_config').update({ onboarding_completed_at: new Date().toISOString() }).eq('user_id', owner)).error).toBeNull()
      for (const [index, id] of recipeIds.entries()) {
        expect((await client.from('recipes').insert({ id, recipe_uuid: id, user_id: owner,
          name: `Slice Three ${index + 1}`, category: 'chicken', servings: 4, favorite: false, tags: [],
          ingredient_sections: [{ label: null, ingredients: index === 0 ? ingredients : [range('carrot')] }],
          instruction_sections: [{ label: null, steps: ['Combine.'] }],
        })).error).toBeNull()
      }
      const sourceBefore = await client.from('recipes').select('id,ingredient_sections').eq('user_id', owner).order('id')
      expect(sourceBefore.error).toBeNull()
      await page.goto('/recipes')
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible()
      for (const id of recipeIds) {
        await page.goto(`/recipes/${id}`)
        await page.getByRole('button', { name: 'Add to Shopping List', exact: true }).click()
        await expect.poll(async () => Object.keys((await read()).document.recipeEntries)).toContain(id)
      }
      const frozen = (await read()).document.recipeEntries
      await page.goto('/shopping')
      await page.reload()
      const rows = page.getByTestId('shopping-item-row')
      const repeated = rows.filter({ has: page.getByText('1–2 + 1–2', { exact: true }) })
      await expect(repeated).toHaveCount(3)
      await expect(rows.getByText('1–2', { exact: true })).toHaveCount(1)
      await expect(rows.getByText('2 cups + as needed + amount unspecified', { exact: true })).toBeVisible()
      await expect(rows.getByText('2 + 100 g', { exact: true })).toBeVisible()
      await expect(rows.getByText('1 14 oz can + 1 14 oz can', { exact: true })).toBeVisible()
      await expect(rows.getByText('1 28 oz can', { exact: true })).toBeVisible()
      await expect(rows.getByText('1/3 cup + 1/3 cup', { exact: true })).toBeVisible()
      await capture('active-after-reload')

      // Copy uses exactly the same main quantity display, including repeated parts.
      if (viewport.width >= 768) {
        await page.getByRole('button', { name: 'Copy', exact: true }).click()
        const copied = await page.evaluate(() => navigator.clipboard.readText())
        expect(copied).toContain('1–2 + 1–2 carrot')
        expect(copied).toContain('2 cups + as needed + amount unspecified flour')
        expect(copied).toContain('1 14 oz can + 1 14 oz can beans')
      }

      const carrotRow = rows.filter({ has: page.getByText('1–2 + 1–2', { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Check off carrot', exact: true }) })
      await carrotRow.getByRole('button', { name: 'Check off carrot', exact: true }).click()
      await expect.poll(async () => Object.values((await read()).document.itemOverrides).some(value => value.checked)).toBe(true)
      await page.reload()
      await expect(carrotRow.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
      await expect(carrotRow.getByRole('button', { name: 'Check off carrot', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: 'Hide 1 done', exact: true }).click()
      await expect(carrotRow).toHaveCount(0)
      await page.getByRole('button', { name: 'Show 1 done', exact: true }).click()
      await expect(carrotRow.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
      await capture('completed-after-reload')
      // Center the target above fixed mobile navigation for visual review.
      await carrotRow.evaluate(element => element.scrollIntoView({ block: 'center' }))
      await expect(carrotRow).toBeInViewport()
      await carrotRow.screenshot({ path: testInfo.outputPath('completed-row.png') })
      await carrotRow.getByRole('button', { name: 'Check off carrot', exact: true }).click()
      await expect.poll(async () => Object.values((await read()).document.itemOverrides).some(value => value.checked)).toBe(false)

      // Existing classification only; task-owned preferences and Pantry rows.
      expect((await client.from('pantry_items').insert({ user_id: owner, item: 'rice' })).error).toBeNull()
      const beforeHide = await read()
      beforeHide.document.preferences.excludedIngredientKeys = ['cumin']
      expect((await client.from('shopping_list').update({ document: beforeHide.document, content_revision: beforeHide.revision + 1 })
        .eq('user_id', owner).eq('content_revision', beforeHide.revision)).error).toBeNull()
      await page.reload()
      if (viewport.width < 768) {
        await page.getByRole('button', { name: 'Expand pantry items', exact: true }).click()
        await page.getByRole('button', { name: 'Expand excluded items', exact: true }).click()
      }
      await expect(page.getByRole('button', { name: /^Restore rice 1–2 \+ 1–2/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Restore cumin 1–2 \+ 1–2/ })).toBeVisible()
      await capture('pantry-excluded-after-reload')
      const excludedChip = page.getByRole('button', { name: /^Restore cumin 1–2 \+ 1–2/ })
      await excludedChip.evaluate(element => element.scrollIntoView({ block: 'center' }))
      await expect(excludedChip).toBeInViewport()
      await excludedChip.screenshot({ path: testInfo.outputPath('excluded-chip.png') })
      expect((await read()).document.recipeEntries).toEqual(frozen)
      const sourceAfter = await client.from('recipes').select('id,ingredient_sections').eq('user_id', owner).order('id')
      expect(sourceAfter.error).toBeNull()
      expect(sourceAfter.data).toEqual(sourceBefore.data)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(diagnostics).toEqual({ pageErrors: 0, externalRequests: 0 })
      await testInfo.attach('scenario-evidence', { body: JSON.stringify({ viewport, diagnostics,
        sourceSnapshotsUnchanged: true, frozenContributionsUnchanged: true,
        verified: ['recipe UI add', 'reload', 'ranges', 'packages', 'unknowns', 'incompatible units', 'fractions', 'copy', 'check/uncheck', 'Pantry/excluded'] }), contentType: 'application/json' })
    } finally {
      await context.close()
      await client.auth.signOut()
      expect((await admin.auth.admin.deleteUser(owner)).error, 'task-owned cleanup').toBeNull()
    }
  })
}
