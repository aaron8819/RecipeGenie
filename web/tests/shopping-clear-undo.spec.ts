import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import {
  applyShoppingDocumentMutation, createEmptyShoppingDocument,
  type ShoppingDocumentMutation, type ShoppingDocumentV3,
} from '../src/lib/shopping-document'
import { E2E_CONFIG } from './e2e-env'
import { createLocalRuntime, localSupabaseEnvironment } from '../scripts/local-e2e-runtime.mjs'

// Real loopback persistence and browser mutations. No shared fixture resets.
// Authentication stays in artifact-free contexts; only Shopping is captured.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test.describe.configure({ mode: 'serial' })

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`conditional Clear Undo with real CAS at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    expect(E2E_CONFIG.target).toBe('local')
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107')
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
    const status = createLocalRuntime(process.cwd()).status()
    expect(status.ok, 'existing local Supabase is required').toBe(true)
    const local = localSupabaseEnvironment(status.output)
    const admin = createClient(local.supabaseUrl, local.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `slice1-${randomUUID()}@example.test`
    const password = randomUUID() + randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    expect(created.error, 'disposable owner creation').toBeNull()
    const owner = created.data.user!.id
    const client = createClient(local.supabaseUrl, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[]
    const evidence: string[] = []
    const diagnostics = { pageErrors: 0, externalRequests: 0 }
    const read = async () => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', owner).single()
      expect(result.error, 'authenticated local read').toBeNull()
      return { document: result.data!.document as ShoppingDocumentV3, contentRevision: result.data!.content_revision as number }
    }
    const replace = async (document: ShoppingDocumentV3) => {
      const current = await read()
      const result = await client.from('shopping_list').update({ document, content_revision: current.contentRevision + 1 })
        .eq('user_id', owner).eq('content_revision', current.contentRevision).select('content_revision').single()
      expect(result.error, 'disposable owner CAS').toBeNull()
    }
    const commit = async (mutation: ShoppingDocumentMutation) => {
      const current = await read()
      await replace(applyShoppingDocumentMutation(current, mutation).document)
    }
    const manual = (name: string) => ({ id: name, displayName: name,
      quantity: { amount: 2, unit: 'count' }, categoryKey: 'produce', bucket: 'items' as const, checked: false })
    const original = createEmptyShoppingDocument()
    original.manualItems = [manual('lemons'), { ...manual('rice'), bucket: 'already_have' },
      { ...manual('cilantro'), bucket: 'excluded', checked: true }]
    original.preferences.categoryOrder = ['misc', 'produce']
    const login = async () => {
      const context = await browser.newContext({ viewport, baseURL: E2E_CONFIG.baseURL })
      contexts.push(context)
      const page = await context.newPage()
      page.on('pageerror', () => diagnostics.pageErrors++)
      page.on('request', request => {
        const url = new URL(request.url())
        if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) diagnostics.externalRequests++
      })
      await page.goto('/shopping')
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible()
      await page.goto('/shopping')
      await expect(page.getByRole('heading', { name: 'Shopping List', exact: true })).toBeVisible()
      return page
    }
    const clear = async (page: Page) => {
      await page.getByRole('button', { name: viewport.width < 768 ? 'Clear list' : 'Clear', exact: true }).click()
    }
    const undo = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true })
    const reload = async (page: Page) => {
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Shopping List', exact: true })).toBeVisible()
    }
    const capture = async (page: Page, name: string) => {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true,
        mask: [page.getByText(email, { exact: true })] })
    }
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
      expect((await client.from('user_config').update({ onboarding_completed_at: new Date().toISOString() }).eq('user_id', owner)).error).toBeNull()
      await replace(original)
      const a = await login()
      const b = await login()
      await clear(a)
      await expect(undo(a)).toBeVisible()
      const cleared = await read()
      expect(cleared.document.manualItems).toEqual([])
      await undo(a).click()
      await expect.poll(async () => (await read()).document).toEqual(original)
      await reload(a)
      await expect(a.getByRole('button', { name: 'Check off lemons', exact: true })).toBeVisible()
      expect((await read()).document).toEqual(original)
      await capture(a, 'manual-restored-after-reload')
      evidence.push('Manual Clear/immediate Undo restored exact persisted content and organization; reload retained result (no durable token claim).')

      await clear(a)
      await expect(undo(a)).toBeVisible()
      await reload(b)
      const add = b.getByPlaceholder(viewport.width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...')
      await add.fill('bread')
      await add.press('Enter')
      await expect.poll(async () => (await read()).document.manualItems.map(item => item.displayName)).toEqual(['bread'])
      await undo(a).click()
      await expect(a.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true })).toBeVisible()
      await capture(a, 'second-session-undo-refused')
      await reload(a)
      await expect(a.getByRole('button', { name: 'Check off bread', exact: true })).toBeVisible()
      evidence.push('Two browser sessions: B added bread after A cleared; A Undo refused and bread survived reload.')

      for (const action of ['organization', 'add-then-remove'] as const) {
        await replace(original)
        await reload(a)
        await clear(a)
        await expect(undo(a)).toBeVisible()
        if (action === 'organization') {
          await commit({ type: 'updatePreferences', preferences: { categoryOrder: ['produce', 'misc'] } })
        } else {
          await commit({ type: 'addManualItem', item: manual('bread') })
          await commit({ type: 'deleteManualItem', id: 'bread' })
        }
        const expected = await read()
        await undo(a).click()
        await expect(a.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true })).toBeVisible()
        expect(await read()).toEqual(expected)
        await reload(a)
        expect(await read()).toEqual(expected)
        evidence.push(`Browser Undo after controlled real database ${action} refused; exact later state survived reload.`)
      }

      // Intercept only timing: every PATCH still goes to real PostgreSQL/RLS/CAS.
      await replace(original)
      await reload(a)
      let successfulPreimage: Awaited<ReturnType<typeof read>> | undefined
      let writes = 0
      await a.route('**/rest/v1/shopping_list*', async route => {
        if (route.request().method() === 'PATCH' && writes++ === 0) {
          await commit({ type: 'addManualItem', item: manual('bread') })
          successfulPreimage = await read()
        }
        await route.continue()
      })
      await clear(a)
      await expect(undo(a)).toBeVisible()
      expect(writes).toBe(2)
      expect((await read()).contentRevision).toBe(successfulPreimage!.contentRevision + 1)
      await a.unrouteAll({ behavior: 'wait' })
      await undo(a).click()
      await expect.poll(async () => (await read()).document).toEqual(successfulPreimage!.document)
      evidence.push('Forced Clear CAS conflict: two real PATCH attempts; Undo restored successful-attempt preimage including concurrent bread; returned revision matched commit.')

      await reload(a)
      await clear(a)
      await expect(undo(a)).toBeVisible()
      writes = 0
      await a.route('**/rest/v1/shopping_list*', async route => {
        if (route.request().method() === 'PATCH') {
          writes++
          await commit({ type: 'addManualItem', item: manual('bread') })
        }
        await route.continue()
      })
      await undo(a).click()
      await expect(a.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true })).toBeVisible()
      expect(writes).toBe(1)
      await a.unrouteAll({ behavior: 'wait' })
      await reload(a)
      expect((await read()).document.manualItems).toEqual([manual('bread')])
      evidence.push('Real write inserted between Undo validation and PATCH: CAS rejected; no retry PATCH; bread survived reload.')

      const recipeId = randomUUID()
      expect((await client.from('recipes').insert({ id: recipeId, recipe_uuid: recipeId, user_id: owner,
        name: 'Slice One Lemons', category: 'chicken', servings: 2, favorite: false, tags: [],
        ingredient_sections: [{ label: null, ingredients: [{ item: 'lemons', amount: 2, unit: 'count' }] }],
        instruction_sections: [{ label: null, steps: ['Combine.'] }],
      })).error).toBeNull()
      await replace(original)
      await a.goto(`/recipes/${recipeId}`)
      await a.getByRole('button', { name: 'Add to Shopping List', exact: true }).click()
      await expect.poll(async () => Object.keys((await read()).document.recipeEntries)).toEqual([recipeId])
      await a.goto('/shopping')
      const edit = async (name: string) => {
        await a.getByTestId('shopping-item-row').filter({ hasText: 'Added manually' }).filter({ hasText: name })
          .getByRole('button', { name: /^Actions for / }).click()
        await a.getByRole('menuitem', { name: 'Edit item', exact: true }).click()
      }
      await edit('lemons')
      await a.getByLabel('Manual item amount', { exact: true }).fill('3.5')
      await a.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(a.getByLabel('Manual item amount', { exact: true })).toHaveCount(0)
      await expect.poll(async () => (await read()).document.manualItems[0].quantity?.amount).toBe(3.5)
      await addItem(a, 'yogurt', viewport.width)
      await edit('yogurt')
      await a.getByLabel('Manual item name', { exact: true }).fill('lemon')
      await a.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(a.locator('form [role="alert"]')).toContainText('Choose a different ingredient name or cancel this edit.')
      await a.getByRole('button', { name: 'Cancel', exact: true }).click()
      await capture(a, 'manual-edit-and-collision-preserved')
      evidence.push('F02 browser quantity edit beside equivalent recipe requirement succeeded; identity-changing collision refused.')
      const recipeBearing = (await read()).document
      await clear(a)
      await expect(a.getByRole('alertdialog')).toContainText('Undo is currently unavailable for lists containing recipe items.')
      expect((await read()).document).toEqual(recipeBearing)
      await capture(a, 'recipe-clear-disclosure')
      await a.getByRole('alertdialog').getByRole('button', { name: 'Clear list', exact: true }).click()
      await expect(a.getByText('Shopping list cleared. Undo is currently unavailable for lists containing recipe items.', { exact: true })).toBeVisible()
      await expect(undo(a)).toHaveCount(0)
      expect((await read()).document.recipeEntries).toEqual({})
      expect((await client.from('recipes').select('id').eq('user_id', owner).eq('id', recipeId)).data).toHaveLength(1)
      evidence.push('Recipe-bearing Clear disclosed limitation before confirmation, retained saved recipe and offered no Undo.')

      // Stale manual-only UI acquires hidden recipe selection before Clear CAS.
      await replace(original)
      await reload(a)
      writes = 0
      await a.route('**/rest/v1/shopping_list*', async route => {
        if (route.request().method() === 'PATCH' && writes++ === 0) {
          const hidden = structuredClone(recipeBearing)
          hidden.recipeEntries[recipeId].ingredients = []
          await replace(hidden)
        }
        await route.continue()
      })
      await clear(a)
      await expect(a.getByText('Shopping list cleared. Undo is currently unavailable for lists containing recipe items.', { exact: true })).toBeVisible()
      await expect(undo(a)).toHaveCount(0)
      expect(writes).toBe(2)
      await a.unrouteAll({ behavior: 'wait' })
      evidence.push('Stale manual-only browser + concurrent hidden recipe selection: retried Clear used final recipe eligibility and offered no Undo.')
      expect(diagnostics).toEqual({ pageErrors: 0, externalRequests: 0 })
    } finally {
      for (const context of contexts) await context.close()
      await client.auth.signOut({ scope: 'global' })
      expect((await admin.auth.admin.deleteUser(owner)).error, 'disposable owner/data cleanup').toBeNull()
      await client.removeAllChannels()
      await admin.removeAllChannels()
      await testInfo.attach('scenario-evidence', { body: JSON.stringify({ evidence, diagnostics, cleanup: 'disposable owner deleted' }, null, 2), contentType: 'application/json' })
    }
  })
}

async function addItem(page: Page, name: string, width: number) {
  const input = page.getByPlaceholder(width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...')
  await input.fill(name)
  await input.press('Enter')
  await expect(page.getByRole('button', { name: `Check off ${name}`, exact: true })).toBeVisible()
}
