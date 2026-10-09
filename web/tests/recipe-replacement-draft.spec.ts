import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { E2E_CONFIG } from './e2e-env'
import { test, expect } from '@playwright/test'
import type { Database } from '../src/types/database.generated'

const source = readFileSync('src/lib/__tests__/latest-recipe.txt', 'utf8').replace(/\r\n/g, '\n')
const labels = ['Chicken', 'Teriyaki Sauce &amp; Marinade', 'Rice', 'Broccoli', 'Optional Garnish']

test('previews the complete replacement draft and saves the same local recipe', async ({
  page,
}) => {
  expect(E2E_CONFIG.target).toBe('local')
  const origin = process.env.RECIPE_GENIE_REPLACEMENT_TEST_ORIGIN || E2E_CONFIG.baseURL
  const app = new URL(origin)
  expect(app.protocol).toBe('http:')
  expect(app.hostname).toBe('127.0.0.1')
  expect(app.username + app.password).toBe('')
  expect(app.origin).toBe(origin)
  const client = createClient<Database>(E2E_CONFIG.supabaseUrl, E2E_CONFIG.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({
    email: E2E_CONFIG.email,
    password: E2E_CONFIG.password,
  })
  if (authError || !auth.user) throw new Error('Disposable local fixture auth failed; redacted')
  const id = randomUUID()
  const fixture = {
    id,
    recipe_uuid: id,
    user_id: auth.user.id,
    name: `Disposable replacement ${id}`,
    category: 'Chicken',
    servings: 2,
    favorite: true,
    tags: ['disposable'],
    ingredient_sections: [{ label: null, ingredients: [{ item: 'rice', amount: 1, unit: 'cup' }] }],
    instruction_sections: [{ label: null, steps: ['Old instruction.'] }],
    notes: ['Old note.'],
  }
  try {
    const { error } = await client.from('recipes').insert(fixture)
    if (error) throw error
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(origin)
    expect(new URL(page.url()).origin).toBe(origin)
    await page.getByLabel('Email', { exact: true }).fill(E2E_CONFIG.email)
    expect(new URL(page.url()).origin).toBe(origin)
    await page.getByLabel('Password', { exact: true }).fill(E2E_CONFIG.password)
    expect(new URL(page.url()).origin).toBe(origin)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.getByRole('link', { name: 'Go to Planner', exact: true }).waitFor()
    await page.goto(`${origin}/recipes/${id}?from=recipes`)
    const detail = page.getByTestId('recipe-detail-page')
    await detail.getByRole('button', { name: 'Edit Recipe', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Recipe', exact: true })
    await dialog.getByRole('tab', { name: 'Replace text', exact: true }).click()
    const input = dialog.getByLabel('Recipe text', { exact: true })
    await input.fill(source)
    await dialog.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Preview recipe', exact: true })).toBeVisible()
    const draft = dialog.getByTestId('replacement-draft')
    await expect(draft.locator('[data-ingredient-group]')).toHaveCount(5)
    await expect(draft.locator('[data-ingredient-group] li')).toHaveCount(19)
    await expect(draft.locator('[data-instruction-group] li')).toHaveCount(6)
    await expect(draft.getByTestId('replacement-draft-notes').locator('li')).toHaveCount(7)
    const ingredients = await draft.locator('[data-ingredient-group] li').allTextContents()
    const steps = await draft.locator('[data-instruction-group] li').allTextContents()
    const notes = await draft.getByTestId('replacement-draft-notes').locator('li').allTextContents()
    const { data: unchanged } = await client
      .from('recipes')
      .select('name')
      .eq('recipe_uuid', id)
      .single()
    expect(unchanged?.name).toBe(fixture.name)
    await dialog.getByRole('button', { name: 'Back to edit', exact: true }).first().click()
    await expect(input).toHaveValue(source)
    await dialog.getByRole('button', { name: 'Review changes', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await expect(detail.locator('h1')).toHaveText('Teriyaki Chicken and Broccoli Rice Bowls')
    const compact = (text: string) => text.replace(/\s+/g, ' ').trim()
    expect(
      (await detail.locator('[data-ingredient-group] li').allInnerTexts()).map(compact),
    ).toEqual(ingredients.map(compact))
    expect(
      (await detail.locator('.detail-instruction-group li p').allTextContents()).map(compact),
    ).toEqual(steps.map(compact))
    await detail.locator('.detail-notes > summary').click()
    expect((await detail.locator('.detail-notes li').allTextContents()).map(compact)).toEqual(
      notes.map(compact),
    )
    const { data: saved, error: readError } = await client
      .from('recipes')
      .select('*')
      .eq('recipe_uuid', id)
      .single()
    if (readError) throw readError
    expect(saved.id).toBe(id)
    expect(saved.recipe_uuid).toBe(id)
    expect(saved.favorite).toBe(true)
    expect(saved.tags).toEqual(fixture.tags)
    expect(saved.prep_time_minutes).toBe(15)
    expect(saved.cook_time_minutes).toBe(25)
    expect(saved.ingredient_sections).toMatchObject(labels.map((label) => ({ label })))
    const third = { amount: '⅓', quantityV1: { value: { numerator: '1', denominator: '3' } } }
    expect(saved.ingredient_sections).toMatchObject(
      labels.map((label) =>
        label === 'Teriyaki Sauce &amp; Marinade'
          ? { label, ingredients: [{}, {}, third, third, {}, {}, {}, {}, {}] }
          : { label },
      ),
    )
  } finally {
    const { error } = await client.rpc('delete_recipe', { p_recipe_uuid: id })
    await client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Disposable local recipe cleanup failed')
  }
})
