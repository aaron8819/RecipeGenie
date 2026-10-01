import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { createEmptyShoppingDocument } from '../src/lib/shopping-document'
import { E2E_CONFIG } from './e2e-env'
import { expect, test } from './fixtures'

// Shares the established local fixture, restores its document, and owns only
// disposable recipe/Pantry rows. Never run against a hosted target.
test.describe.configure({ mode: 'serial' })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

async function editManual(page: Page, name: string) {
  const row = page.getByTestId('shopping-item-row').filter({ hasText: name })
  const manual = row.filter({ hasText: 'Manual' })
  await manual.getByRole('button', { name: /^Actions for / }).click()
  await page.getByRole('menuitem', { name: 'Edit item', exact: true }).click()
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`focused design corrections at ${viewport.width}x${viewport.height}`, async ({ page, setupAuth }, testInfo) => {
    test.setTimeout(180_000)
    expect(E2E_CONFIG.target).toBe('local')
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107')
    const client = createClient(E2E_CONFIG.supabaseUrl, E2E_CONFIG.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const auth = await client.auth.signInWithPassword({ email: E2E_CONFIG.email, password: E2E_CONFIG.password })
    expect(auth.error, 'local authentication').toBeNull()
    const userId = auth.data.user!.id
    const recipeId = randomUUID()
    const recipeName = 'Corrective Lemon Chicken'
    const pantryName = `corrective herb ${recipeId.slice(0, 8)}`
    const pantryBefore = await client.from('pantry_items').select('id,item').eq('user_id', userId)
    expect(pantryBefore.error).toBeNull()
    const original = await client.from('shopping_list').select('document,content_revision').eq('user_id', userId).single()
    expect(original.error).toBeNull()
    const diagnostics = { pageErrors: 0, serverErrors: 0, externalRequests: 0 }
    page.on('pageerror', () => diagnostics.pageErrors++)
    page.on('response', response => { if (response.status() >= 500) diagnostics.serverErrors++ })
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) diagnostics.externalRequests++
    })
    const capture = async (name: string, fullPage = true) => {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage,
        mask: [page.getByText(E2E_CONFIG.email, { exact: true })] })
    }
    const readDocument = async () => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', userId).single()
      expect(result.error).toBeNull()
      return result.data!
    }
    try {
      const seeded = await client.from('shopping_list').update({
        document: createEmptyShoppingDocument(), content_revision: original.data!.content_revision + 1,
      }).eq('user_id', userId).eq('content_revision', original.data!.content_revision).select().single()
      expect(seeded.error).toBeNull()
      const recipe = await client.from('recipes').insert({
        id: recipeId, recipe_uuid: recipeId, user_id: userId, name: recipeName,
        category: 'chicken', servings: 2, favorite: false, tags: [],
        ingredient_sections: [{ label: null, ingredients: [
          { item: 'lemons', amount: 2, unit: 'count' },
          { item: pantryName, amount: 1, unit: 'tsp' },
          { item: 'kosher salt', amount: 1, unit: 'tsp' },
        ] }], instruction_sections: [{ label: null, steps: ['Combine ingredients.'] }],
      })
      expect(recipe.error).toBeNull()
      await page.setViewportSize(viewport)
      await setupAuth()
      await page.goto('/shopping')
      const add = page.getByPlaceholder(viewport.width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...')
      await add.fill('lemons')
      await add.press('Enter')
      await expect(page.getByText('lemons', { exact: true })).toBeVisible()
      await editManual(page, 'lemons')
      await page.getByLabel('Manual item amount', { exact: true }).fill('2')
      await page.getByLabel('Manual item unit', { exact: true }).fill('count')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.getByLabel('Manual item amount', { exact: true })).toHaveCount(0)
      await add.fill('yogurt')
      await add.press('Enter')
      await expect(page.getByText('yogurt', { exact: true })).toBeVisible()
      await page.goto(`/recipes/${recipeId}`)
      await page.getByRole('button', { name: 'Add to Shopping List', exact: true }).click()
      await expect.poll(async () => Object.keys((await readDocument()).document.recipeEntries)).toContain(recipeId)
      const frozen = (await readDocument()).document.recipeEntries
      await page.goto('/shopping')
      await expect(page.getByTestId('shopping-item-row').filter({ hasText: /lemon/ })).toHaveCount(2)
      await editManual(page, 'lemons')
      await page.getByLabel('Manual item amount', { exact: true }).fill('3.5')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await capture('shopping-edit-result')
      const rejected = await page.locator('form [role="alert"]').isVisible()
      if (rejected) await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await editManual(page, 'yogurt')
      await page.getByLabel('Manual item amount', { exact: true }).fill('2')
      await page.getByLabel('Manual item unit', { exact: true }).fill('cup')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.getByLabel('Manual item amount', { exact: true })).toHaveCount(0)
      expect(rejected, 'same-identity edit must succeed, just like the nonduplicate edit').toBe(false)
      await page.reload()
      await expect.poll(async () => (await readDocument()).document.manualItems.find((item: { displayName: string }) => item.displayName === 'lemons')?.quantity.amount).toBe(3.5)
      expect((await readDocument()).document.recipeEntries).toEqual(frozen)
      await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'Added manually' }).filter({ hasText: 'lemons' })).toContainText('3½')
      await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'Needs: 2 lemon' })).toContainText(recipeName)
      await editManual(page, 'yogurt')
      await page.getByLabel('Manual item name', { exact: true }).fill('lemon')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.locator('form [role="alert"]')).toContainText('Choose a different ingredient name or cancel this edit.')
      await capture('shopping-collision')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      const toggle = page.getByRole('button', { name: 'Check off yogurt', exact: true })
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.focus()
      await page.keyboard.press('Space')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await readDocument()).document.manualItems.find((item: { displayName: string }) => item.displayName === 'yogurt')?.checked).toBe(true)
      await capture('shopping-checked')
      await page.getByRole('button', { name: 'Organize', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Enter Manage Mode', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Reorder lemons', exact: true })).toHaveCount(2)
      await capture('shopping-reorder-controls')
      await page.getByRole('button', { name: 'Organize', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Shopping settings', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Reorder Fresh Produce category', exact: true })).toBeVisible()
      await page.getByRole('tab', { name: 'Custom', exact: true }).click()
      await page.getByRole('textbox', { name: 'New shopping category name', exact: true }).fill('Corrective Section')
      await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('button', { name: 'Edit Corrective Section category', exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'Name for Corrective Section category', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Cancel editing Corrective Section category', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Delete Corrective Section category', exact: true })).toBeVisible()
      await capture('shopping-category-controls', false)
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

      await page.goto('/pantry')
      await page.getByPlaceholder('Add pantry item (comma-separated)...').fill(pantryName)
      await page.getByRole('button', { name: 'Submit pantry items', exact: true }).click()
      await expect(page.getByRole('button', { name: `Actions for ${pantryName}`, exact: true })).toBeVisible()
      await page.goto('/shopping')
      if (viewport.width < 768) await page.getByRole('button', { name: 'Expand pantry items', exact: true }).click()
      const restoreHerb = page.getByRole('button', { name: new RegExp(`^Restore ${pantryName}`) })
      await expect(restoreHerb).toBeVisible()
      expect((await readDocument()).document.recipeEntries).toEqual(frozen)
      await capture('pantry-live-projection')
      await page.goto('/pantry')
      await page.getByRole('button', { name: `Actions for ${pantryName}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
      await expect(page.getByRole('button', { name: `Actions for ${pantryName}`, exact: true })).toHaveCount(0)
      await page.goto('/shopping')
      await expect(page.getByRole('button', { name: `Check off ${pantryName}`, exact: true })).toBeVisible()
      await page.goto('/pantry')
      if (viewport.width < 768) await page.getByRole('button', { name: /^Excluded \d+$/ }).click()
      await page.getByPlaceholder('Add excluded keyword (comma-separated)...').fill(pantryName)
      await page.getByRole('button', { name: 'Submit excluded keywords', exact: true }).click()
      await expect(page.getByRole('button', { name: `Actions for ${pantryName}`, exact: true })).toBeVisible()
      await page.getByRole('checkbox', { name: 'Salt variants', exact: true }).click()
      await expect(page.getByRole('checkbox', { name: 'Salt variants', exact: true })).toBeChecked()
      await expect.poll(async () => (await readDocument()).document.preferences.excludeSaltVariants).toBe(true)
      await capture('pantry')
      await expect(page.getByText(/no clearing or regeneration is needed/)).toBeVisible()
      await page.goto('/shopping')
      if (viewport.width < 768) await page.getByRole('button', { name: 'Expand excluded items', exact: true }).click()
      await expect(restoreHerb).toBeVisible()
      await expect(page.getByRole('button', { name: /^Restore kosher salt / })).toBeVisible()
      await restoreHerb.click()
      await expect(page.getByRole('button', { name: `Check off ${pantryName}`, exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', { name: `Check off ${pantryName}`, exact: true })).toBeVisible()
      expect((await readDocument()).document.recipeEntries).toEqual(frozen)
      await capture('explicit-override')
      await page.goto('/planner')
      await expect(page.getByText(/on track to hit your nutrition goals/)).toHaveCount(0)
      await capture('planner')
      await page.goto('/recipes')
      await expect(page.getByText(recipeName, { exact: true })).toBeVisible()
      if (viewport.width < 768) await page.getByTestId('recipes-add-fab').click()
      else await page.getByTestId('recipes-add-button').click()
      await page.getByText('Recipe Name', { exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'Recipe Name', exact: true })).toBeFocused()
      await capture('recipe-name-label', false)
      await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toBeVisible()
      await page.getByText('Tags', { exact: true }).click()
      await expect(page.getByRole('combobox', { name: 'Tags', exact: true })).toBeFocused()
      await capture('recipe-labels', false)
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: /Settings/ }).click()
      await expect(page.getByRole('button', { name: 'Reorder chicken category', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Edit chicken category', exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'Name for chicken category', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Cancel editing chicken category', exact: true }).click()
      await capture('category-controls', false)
      expect(diagnostics).toEqual({ pageErrors: 0, serverErrors: 0, externalRequests: 0 })
      await testInfo.attach('diagnostics', { body: JSON.stringify(diagnostics), contentType: 'application/json' })
    } finally {
      // Restore the audited fixture's document, then remove only this test's recipe.
      await page.goto('about:blank')
      const current = await readDocument()
      const restore = await client.from('shopping_list').update({ document: original.data!.document,
        content_revision: current.content_revision + 1 }).eq('user_id', userId)
        .eq('content_revision', current.content_revision).select().single()
      expect(restore.error, 'fixture document restoration').toBeNull()
      expect(restore.data?.document).toEqual(original.data!.document)
      const pantryCleanup = await client.from('pantry_items').delete().eq('user_id', userId).eq('item', pantryName)
      expect(pantryCleanup.error, 'disposable Pantry cleanup').toBeNull()
      const pantryAfter = await client.from('pantry_items').select('id,item').eq('user_id', userId)
      expect(pantryAfter.error).toBeNull()
      expect(pantryAfter.data?.sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual(pantryBefore.data?.sort((a, b) => a.id.localeCompare(b.id)))
      const removed = await client.rpc('delete_recipe', { p_recipe_uuid: recipeId })
      expect(removed.error, 'disposable recipe cleanup').toBeNull()
      await client.auth.signOut({ scope: 'local' })
    }
  })
}
