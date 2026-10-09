import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect } from '@playwright/test'
import { E2E_CONFIG, signInToRecipeGenie, dismissOnboardingModal } from './e2e-env'
import type { Database } from '../src/types/database.generated'

const replacementText = `Teriyaki Chicken and Broccoli Rice Bowls
Yield: 4 servings

Ingredients:
1 1/2 lb chicken thighs
1/4 cup low-sodium soy sauce
1 tbsp brown sugar

Instructions:
1. Mix the sauce.
2. Cook the chicken and serve with rice.`

test.use({ storageState: { cookies: [], origins: [] } })

for (const device of [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'iPhone size (emulated)', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) test.describe(device.name, () => {
  test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch })
  test('recipe detail copy and same-recipe replacement journey', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  // Fixture creation and cleanup are admitted only on the existing loopback backend.
  expect(E2E_CONFIG.target).toBe('local')
  expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321')
  const client = createClient<Database>(E2E_CONFIG.supabaseUrl, E2E_CONFIG.supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email: E2E_CONFIG.email, password: E2E_CONFIG.password })
  if (authError || !auth.user) throw new Error('Local fixture sign-in failed')
  const uuid = randomUUID()
  const id = uuid
  const fixture = {
    id, recipe_uuid: uuid, user_id: auth.user.id, name: 'Teriyaki Chicken and Broccoli Rice Bowls',
    category: 'chicken', servings: 4, favorite: true, tags: ['quick'],
    ingredient_sections: [{ label: null, ingredients: [
      { amount: 1.5, unit: 'lb', item: 'chicken thighs' },
      { amount: 0.25, unit: 'cup', item: 'soy sauce' },
      { amount: 7.5, unit: 'tsp', item: 'brown sugar' },
    ] }],
    instruction_sections: [{ label: null, steps: ['Mix the sauce.', 'Cook the chicken and serve with rice.'] }],
    notes: ['Keep leftovers chilled.'], prep_time_minutes: 10, image_url: null,
    created_at: '2024-01-02T03:04:05.000Z',
  }
  const errors: string[] = []
  let seeded = false
  page.on('pageerror', error => errors.push(error.message))
  try {
    const { error: seedError } = await client.from('recipes').insert(fixture)
    if (seedError) throw seedError
    seeded = true
    const { error: historyError } = await client.from('recipe_history').insert({ recipe_id: id, recipe_uuid: uuid, user_id: auth.user.id, date_made: '2026-10-01T12:00:00.000Z' })
    if (historyError) throw historyError
    const { data: originalHistory } = await client.from('recipe_history').select('*').eq('recipe_uuid', uuid)
    await signInToRecipeGenie(page)
    await dismissOnboardingModal(page)
    await page.goto(`/recipes/${uuid}?from=recipes`)
    const detail = page.getByTestId('recipe-detail-page')
    await expect(detail.locator('h1')).toHaveText(fixture.name)
    await expect(detail.locator('.detail-amount').first()).toHaveText('1 1/2 lb')
    await page.screenshot({ path: testInfo.outputPath('detail.png'), fullPage: true, mask: [page.locator('aside [title]')] })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { document.documentElement.dataset.copiedRecipe = text },
        readText: async () => { throw new Error('Denied for fallback test') },
      } })
    })
    await detail.getByRole('button', { name: 'Adjust yield' }).click()
    await page.getByRole('button', { name: 'Increase yield' }).click()
    await page.keyboard.press('Escape')
    await detail.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(detail.locator('.detail-copy-status')).toHaveText('Recipe copied')
    const copied = await page.evaluate(() => document.documentElement.dataset.copiedRecipe)
    expect(copied).toContain('Yield: 5 servings')
    expect(copied).toContain('1 7/8 lb chicken thighs')
    expect(copied).toContain('Keep leftovers chilled.')
    expect(copied).toContain('2. Cook the chicken')
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('Denied') } })
    })
    await detail.getByRole('button', { name: 'Copy', exact: true }).click()
    const copyDialog = page.getByRole('dialog', { name: 'Copy recipe' })
    await expect(copyDialog.getByRole('textbox')).toHaveValue(copied!)
    await copyDialog.getByRole('button', { name: 'Select all' }).click()
    expect(await copyDialog.getByRole('textbox').evaluate((input: HTMLTextAreaElement) => input.selectionEnd - input.selectionStart)).toBe(copied!.length)
    await page.keyboard.press('Escape')

    await detail.getByRole('button', { name: 'Edit Recipe' }).click()
    const editor = page.getByRole('dialog', { name: 'Edit Recipe', exact: true })
    await editor.getByRole('tab', { name: 'Replace text' }).click()
    const input = editor.getByLabel('Recipe text', { exact: true })
    await editor.getByRole('button', { name: 'Paste', exact: true }).click()
    await expect(editor.getByText(/Touch and hold in the text box/)).toBeVisible()
    await expect(input).toBeFocused()
    expect(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
    await input.fill('This is not a recipe')
    await editor.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Ingredients')
    await expect(input).toHaveValue('This is not a recipe')
    // Browser Back must retain the paste until the user explicitly discards it.
    await page.goBack()
    const discard = page.getByRole('alertdialog')
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: 'Keep editing' }).click()
    await expect(input).toHaveValue('This is not a recipe')
    await input.fill('')
    await page.evaluate((text: string) => {
      let reads = 0
      Object.defineProperty(navigator.clipboard, 'readText', { value: async () => {
        document.documentElement.dataset.pasteReads = String(++reads)
        await new Promise(resolve => setTimeout(resolve, 50))
        return text
      } })
    }, replacementText)
    await editor.getByRole('button', { name: 'Paste', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click() })
    await expect(input).toHaveValue(replacementText)
    expect(await page.evaluate(() => document.documentElement.dataset.pasteReads)).toBe('1')
    if (device.isMobile) {
      await page.setViewportSize({ width: 390, height: 420 })
      await input.focus()
      const action = editor.getByRole('button', { name: 'Review changes', exact: true })
      await action.focus()
      await expect(action).toBeFocused()
      await expect.poll(async () => {
        const box = await action.boundingBox()
        return box!.y + box!.height
      }).toBeLessThanOrEqual(420)
      await page.screenshot({ path: testInfo.outputPath('keyboard-height.png') })
      await page.setViewportSize(device.viewport)
    }
    // Native textarea input remains usable when the clipboard API is denied.
    await input.fill(replacementText + '\n\n## Nutrition\nProtein 10g')
    await editor.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Protein 10g')
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await editor.getByRole('button', { name: 'Back to text' }).click()
    await expect(input).toHaveValue(replacementText + '\n\n## Nutrition\nProtein 10g')
    await input.fill(replacementText)
    await editor.getByRole('button', { name: 'Review changes', exact: true }).click()
    const review = editor.getByTestId('replacement-review')
    await expect(review).toContainText('1/4 cup soy sauce')
    await expect(review).toContainText('1/4 cup low-sodium soy sauce')
    await expect(review).toContainText('2 ingredient changes')
    await expect(review).toContainText('Unchanged: title, servings, times, instructions, notes, category, tags, image.')
    await editor.locator('.scrollbar-recipe-dialog').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: testInfo.outputPath('review.png'), mask: [page.locator('aside [title]')] })
    await review.getByText('Full recipe', { exact: true }).click()
    await expect(review.getByText('Keep leftovers chilled.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('review-expanded.png'), mask: [page.locator('aside [title]')] })
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing' }).click()
    await expect(review).toBeVisible()

    let writes = 0
    await page.route('**/rest/v1/recipes?*', async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes++
      if (writes === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic save failure', code: 'TEST' }) })
      await new Promise(resolve => setTimeout(resolve, 300))
      return route.continue()
    })
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Your edits are still here')
    await expect(review).toContainText('low-sodium soy sauce')
    await editor.getByRole('button', { name: 'Back to text' }).click()
    await expect(input).toHaveValue(replacementText)
    await editor.getByRole('button', { name: 'Review changes', exact: true }).click()
    await editor.getByRole('button', { name: 'Save changes', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click() })
    await expect(editor).toBeHidden()
    expect(writes).toBe(2)
    await page.reload()
    await expect(detail).toContainText('low-sodium soy sauce')
    const { data: saved, error: readError } = await client.from('recipes').select('*').eq('recipe_uuid', uuid).single()
    if (readError) throw readError
    expect(saved.id).toBe(id)
    expect(saved.recipe_uuid).toBe(uuid)
    expect(saved.user_id).toBe(auth.user.id)
    expect(saved.favorite).toBe(true)
    expect(saved.tags).toEqual(fixture.tags)
    expect(saved.notes).toEqual(fixture.notes)
    expect(saved.category).toBe(fixture.category)
    expect(new Date(saved.created_at!).toISOString()).toBe('2024-01-02T03:04:05.000Z')
    const { data: history } = await client.from('recipe_history').select('*').eq('recipe_uuid', uuid)
    expect(history).toEqual(originalHistory)
    // Cancel with explicit discard must not perform a save or alter the recipe.
    await detail.getByRole('button', { name: 'Edit Recipe' }).click()
    await editor.getByRole('tab', { name: 'Replace text' }).click()
    await input.fill('Unsaved pasted text')
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(editor).toBeHidden()
    expect(writes).toBe(2)
    expect(errors).toEqual([])
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
    const { error } = seeded ? await client.rpc('delete_recipe', { p_recipe_uuid: uuid }) : { error: null }
    if (error) throw new Error(`Local fixture cleanup failed: ${error.message}`)
    const { count } = await client.from('recipes').select('*', { count: 'exact', head: true }).eq('recipe_uuid', uuid)
    expect(count).toBe(0)
    await client.auth.signOut({ scope: 'local' })
  }
})

})
