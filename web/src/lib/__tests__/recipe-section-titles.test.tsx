import React from 'react'
import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Json } from '@/types/database'
import { parseRecipeText } from '../recipe-parser'
import { mapRecipeRow, type RecipeRow } from '../recipe-identity'
import { recipePlainText } from '../recipe-plain-text'
import {
  parseQuantityV1,
  quantityMatchesLegacy,
  quantityToPersistenceAmount,
} from '../recipe-quantity'
import {
  applyParsedRecipeToFormValues,
  buildEditingRecipeDialogFormValues,
  buildRecipeSubmissionData,
} from '@/components/recipes/recipe-dialog.defaults'
import { RecipeReplacementReview } from '@/components/recipes/recipe-replacement-review'
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures'

const source = readFileSync('src/lib/__tests__/supplied-recipe.txt', 'utf8')
  .replace(/\r\n/g, '\n')
  .trimEnd()
const updatedSource = readFileSync('src/lib/__tests__/updated-recipe.txt', 'utf8')
  .replace(/\r\n/g, '\n')
  .trimEnd()
const latestSource = readFileSync('src/lib/__tests__/latest-recipe.txt', 'utf8')
  .replace(/\r\n/g, '\n')
  .trimEnd()
const escapedUpdatedSource = updatedSource.split('\n')
  .map(line => line.replace(/([*.-])/g, '\\$1') + '\\')
  .join('\r\n')
const ingredientLabels = [
  'Chicken',
  'Teriyaki Sauce &amp; Marinade',
  'Rice',
  'Broccoli',
  'Optional Garnish',
]
const instructionLabels = [
  'Prepare the Teriyaki Marinade',
  'Cook the Rice',
  'Air Fry the Chicken',
  'Cook the Broccoli',
  'Thicken the Teriyaki Sauce',
  'Glaze the Chicken',
  'Assemble Bowls',
]

describe('isolated plain recipe section titles', () => {
  it('preserves every supplied ingredient, quantity, instruction paragraph and note', () => {
    const parsed = parseRecipeText(source)
    expect(parsed.ingredientSections.map((section) => section.label)).toEqual(ingredientLabels)
    expect(parsed.ingredientSections.map((section) => section.ingredients.length)).toEqual([
      2, 9, 2, 4, 2,
    ])
    expect(parsed.instructionSections.map((section) => section.label)).toEqual(instructionLabels)
    expect(parsed.instructionSections.map((section) => section.steps.length)).toEqual([
      3, 3, 6, 5, 5, 3, 4,
    ])
    const ingredientSource = source
      .split('\nInstructions\n')[0]
      .split('\n')
      .filter((line) => line.startsWith('* '))
      .map((line) => line.slice(2))
    expect(
      parsed.ingredientSections
        .flatMap((section) => section.ingredients)
        .map((ingredient) => ingredient.originalText),
    ).toEqual(ingredientSource)
    const paragraphs = source
      .split('\nInstructions\n')[1]
      .split('\nNotes\n')[0]
      .trim()
      .split('\n\n')
      .filter((paragraph) => !/^\d+\. /.test(paragraph))
    expect(parsed.instructionSections.flatMap((section) => section.steps)).toEqual(paragraphs)
    const notes = source
      .split('\nNotes\n')[1]
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(2))
    expect(parsed.notes).toEqual(['Marinate time: 30 minutes', ...notes])
    expect(parsed.metadata).toMatchObject({ prepTimeMinutes: 15, cookTimeMinutes: 25 })
    expect(parsed.servings).toBe(4)
    expect(parsed.category).toBe('chicken')
    expect(parsed.unparsedContent).toEqual([])
    expect(parsed.warnings).toContain(
      '"Marinate time: 30 minutes" was preserved in Notes; no dedicated timing field exists.',
    )
  })

  it.each([
    ['original', source],
    ['updated', updatedSource],
    ['latest', latestSource],
    ['escaped clipboard', escapedUpdatedSource],
  ])('keeps %s structure through review, same-recipe local save, reload and editing', (_, text) => {
    // Disposable local persistence adapter: no Supabase or production data access.
    const original = canonicalizeRecipeFixture({
      name: 'Disposable fixture',
      category: 'Chicken',
      favorite: true,
      tags: ['keep'],
      legacyId: 'local-fixture',
      image_url: 'https://example.com/fixture.jpg',
      ingredientSections: [
        { label: null, ingredients: [{ item: 'rice', amount: 1, unit: 'cup' }] },
      ],
      instructionSections: [{ label: null, steps: ['Cook.'] }],
    })
    const baseline = buildEditingRecipeDialogFormValues(original)
    const parsed = parseRecipeText(text)
    const updated = applyParsedRecipeToFormValues(baseline, parsed)
    render(
      <RecipeReplacementReview
        updated={updated}
        unparsed={parsed.unparsedContent ?? []}
        warnings={parsed.warnings}
      />,
    )
    const review = within(screen.getByTestId('replacement-review'))
    const labels = [
      ...ingredientLabels,
      ...parsed.instructionSections.flatMap((s) => (s.label ? [s.label] : [])),
    ]
    for (const label of labels) {
      expect(
        review.getAllByText(
          (_, element) =>
            /^H[1-6]$/.test(element?.tagName ?? '') && !!element?.textContent?.includes(label),
        ).length,
      ).toBeGreaterThan(0)
    }
    expect(review.queryByRole('alert')).toBeNull()
    expect(review.queryByText('Current', { exact: true })).toBeNull()
    expect(review.queryByText('Updated', { exact: true })).toBeNull()
    const draft = within(review.getByTestId('replacement-draft'))
    expect(draft.getAllByRole('listitem')).toHaveLength(
      19 +
        parsed.instructionSections.flatMap((section) => section.steps).length +
        (parsed.notes?.length ?? 0),
    )
    const submission = buildRecipeSubmissionData(updated)
    const row: RecipeRow = {
      ...submission,
      id: original.legacyId!,
      recipe_uuid: original.id,
      user_id: original.user_id,
      servings: submission.servings ?? updated.servings,
      favorite: original.favorite,
      created_at: original.created_at,
      updated_at: '2026-10-09T00:00:00.000Z',
      prep_time_minutes: submission.prep_time_minutes ?? null,
      cook_time_minutes: submission.cook_time_minutes ?? null,
      total_time_minutes: submission.total_time_minutes ?? null,
      ingredient_sections: JSON.parse(JSON.stringify(submission.ingredient_sections)) as Json,
      instruction_sections: JSON.parse(JSON.stringify(submission.instruction_sections)) as Json,
      yield_metadata: JSON.parse(JSON.stringify(submission.yield_metadata ?? null)) as Json,
      notes: submission.notes ?? [],
      image_url: submission.image_url ?? null,
      tags: submission.tags ?? [],
    }
    const reloaded = mapRecipeRow(JSON.parse(JSON.stringify(row)) as RecipeRow)
    expect(reloaded).toMatchObject({
      id: original.id,
      legacyId: original.legacyId,
      favorite: true,
      tags: ['keep'],
      image_url: original.image_url,
    })
    expect(reloaded.instructionSections).toEqual(parsed.instructionSections)
    expect(reloaded.ingredientSections.map((section) => section.label)).toEqual(ingredientLabels)
    expect(reloaded.notes).toEqual(parsed.notes)
    expect(buildEditingRecipeDialogFormValues(reloaded)).toEqual(updated)
    const display = recipePlainText(reloaded, 4)
    for (const label of labels) expect(display).toContain(label)
    for (const note of parsed.notes ?? []) expect(display).toContain(note)
    expect(display).toContain('1 1/2 lb')
    expect(display).toContain('1/3 cup')
    if (text === source) expect(display).toContain('1 1/4 cup')
  })

  it('accepts the updated paste with six inline steps and all seven notes', () => {
    const parsed = parseRecipeText(updatedSource)
    expect(parsed.ingredientSections.map((s) => s.label)).toEqual(ingredientLabels)
    expect(parsed.ingredientSections.map((s) => s.ingredients.length)).toEqual([2, 9, 2, 4, 2])
    expect(parsed.instructionSections).toEqual([
      {
        label: null,
        steps: updatedSource
          .split('\nInstructions\n')[1]
          .split('\nNotes\n')[0]
          .trim()
          .split('\n')
          .map((line) => line.replace(/^\d+\. /, '')),
      },
    ])
    expect(parsed.notes).toEqual(
      updatedSource
        .split('\nNotes\n')[1]
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(2)),
    )
    expect(parsed.notes).toHaveLength(7)
    expect(parsed.unparsedContent).toEqual([])
    expect(parsed.metadata).toMatchObject({ prepTimeMinutes: 15, cookTimeMinutes: 25 })
    const amountless = parsed.ingredientSections
      .flatMap((s) => s.ingredients)
      .filter((i) => i.amount === null)
      .map((i) => i.item)
    expect(amountless).toEqual([
      'Water (per rice cooker instructions)',
      'Salt and black pepper',
      'Green onions',
      'Sesame seeds',
    ])
  })

  it('compares repeating compatibility decimals exactly without accepting mismatches', () => {
    for (const authored of ['⅓', '⅔', '1⅓', '1/6', '1/7']) {
      const quantity = parseQuantityV1(authored)
      expect(quantity.kind).toBe('exact')
      if (quantity.kind !== 'exact') throw new Error('Invalid fixture')
      const amount = Number(quantity.value.numerator) / Number(quantity.value.denominator)
      expect(quantityMatchesLegacy(quantity, amount)).toBe(true)
      expect(quantityMatchesLegacy(quantity, amount + 0.001)).toBe(false)
      expect(quantityMatchesLegacy(quantity, '0.333')).toBe(false)
    }
  })

  it.each([
    '* Salt and black pepper, to taste\n* Sliced green onions\n* Sesame seeds',
    'Salt and black pepper, to taste\nSliced green onions\nSesame seeds',
    'salt\n\n* 1 cup rice',
    '1 cup rice\n\n* Salt\n* Pepper',
  ])('does not make amountless or quantified ingredients into labels: %s', (body) => {
    const parsed = parseRecipeText(`Dinner\nIngredients\n\n${body}\n\nInstructions\nCook.`)
    expect(parsed.ingredientSections.map((section) => section.label)).toEqual([null])
  })

  it('recognizes repeated labels and guards dropped empty explicit sections', () => {
    const parsed = parseRecipeText(
      'Dinner\nIngredients\n\nSauce\n\n* 1 cup milk\n\nSauce\n\n* 1 cup water\nInstructions\nCook.',
    )
    expect(parsed.ingredientSections.map((section) => section.label)).toEqual(['Sauce', 'Sauce'])
    expect(
      parseRecipeText('Dinner\nIngredients\nEmpty:\nMain:\n1 cup rice\nInstructions\nCook.')
        .unparsedContent,
    ).toContain('Empty:')
  })

  it('keeps numbered sentences, short steps and wrapped list steps as steps', () => {
    const parsed = parseRecipeText(
      'Dinner\nIngredients\n1 cup rice\nInstructions\n1. Mix\n\nLet it rest.\n\n2. Cook the rice\n\nServe hot.\n\n3. Finish Bowls\n  Add sauce.',
    )
    expect(parsed.instructionSections.map((section) => section.label)).toEqual([null])
    expect(parsed.instructionSections[0].steps).toEqual([
      'Mix',
      'Let it rest.',
      'Cook the rice',
      'Serve hot.',
      'Finish Bowls Add sauce.',
    ])
  })

  it('preserves other unsupported timing attributes verbatim in notes', () => {
    const parsed = parseRecipeText(
      'Dinner\nRest time: overnight\nChill time: 2 hours\nIngredients\n1 cup rice\nInstructions\nCook.\nNotes\nKeep cool.',
    )
    expect(parsed.notes).toEqual(['Rest time: overnight', 'Chill time: 2 hours', 'Keep cool.'])
    expect(parsed.unparsedContent).toEqual([])
  })
})

describe('replacement timing aliases', () => {
  it.each(['Prep', 'Preparation', '**Prep:**'])(
    'accepts %s alongside cook/total aliases',
    (label) => {
      const text = latestSource
        .replace('Prep time:', label.endsWith('**') ? label : label + ':')
        .replace('Cook time:', 'Cook:')
        .replace('Cook: 25 minutes', 'Cook: 25 minutes\nTotal: 40 minutes')
      const parsed = parseRecipeText(text)
      expect(parsed.metadata).toMatchObject({
        prepTimeMinutes: 15,
        cookTimeMinutes: 25,
        totalTimeMinutes: 40,
      })
      expect(parsed.unparsedContent).toEqual([])
    },
  )
  it('preserves short marination metadata verbatim in Notes with a limitation warning', () => {
    const parsed = parseRecipeText(
      latestSource.replace('Cook time:', 'Marinate: 30 minutes\nCook:'),
    )
    expect(parsed.notes?.[0]).toBe('Marinate: 30 minutes')
    expect(parsed.notes).toHaveLength(8)
    expect(parsed.unparsedContent).toEqual([])
    expect(parsed.warnings).toContain(
      '"Marinate: 30 minutes" was preserved in Notes; no dedicated timing field exists.',
    )
  })
  it('still blocks conflicting aliases and unknown source metadata', () => {
    const conflict = parseRecipeText(
      latestSource.replace('Prep time: 15 minutes', 'Prep: 10 minutes\nPrep time: 15 minutes'),
    )
    expect(conflict.unparsedContent?.length).toBeGreaterThan(0)
    const unknown = parseRecipeText(
      latestSource.replace('Cook time:', 'Author: Someone\nCook time:'),
    )
    expect(unknown.unparsedContent).toContain('Author: Someone')
  })
})

describe('exact quantity persistence compatibility', () => {
  it.each(['⅓', '2/3', '1 1/7', 'about ⅓'])('persists %s as an exact lexeme', (text) => {
    const quantity = parseQuantityV1(text)
    const amount = quantityToPersistenceAmount(quantity)
    expect(typeof amount).toBe('string')
    expect(quantityMatchesLegacy(quantity, amount)).toBe(true)
  })
  it.each(['1½', '1/4', '0.1', '4'])('retains exact terminating numeric amounts for %s', (text) => {
    expect(typeof quantityToPersistenceAmount(parseQuantityV1(text))).toBe('number')
  })
  it('keeps existing compatibility formatting for exact approximate ranges', () => {
    expect(quantityToPersistenceAmount(parseQuantityV1('about 0.50–1'))).toBe('0.5–1')
  })
  it('preserves fractional range endpoints without rounding', () => {
    const quantity = parseQuantityV1('⅓–⅔')
    expect(quantityToPersistenceAmount(quantity)).toBe('⅓–⅔')
  })
})

describe('short timing labels in neighboring sections', () => {
  it('keeps Prep/Cook headings and cooking prose distinct from timing metadata', () => {
    const headings = parseRecipeText(
      'Dinner\nIngredients:\nPrep:\n1 cup rice\nInstructions:\nPrep:\nWash rice.\nCook:\nSimmer for 15 minutes.',
    )
    expect(headings.ingredientSections.map((section) => section.label)).toEqual(['Prep'])
    expect(headings.instructionSections.map((section) => section.label)).toEqual(['Prep', 'Cook'])
    expect(headings.unparsedContent).toEqual([])
    const prose = parseRecipeText(
      'Dinner\nIngredients:\n1 cup rice\nInstructions:\nCook: Sear chicken.',
    )
    expect(prose.instructionSections[0].steps).toEqual(['Cook: Sear chicken.'])
    expect(prose.unparsedContent).toEqual([])
    const misplaced = parseRecipeText(
      'Dinner\nIngredients:\n1 cup rice\nCook: 15 minutes\nInstructions:\nCook rice.',
    )
    expect(misplaced.unparsedContent).toContain('Cook: 15 minutes')
  })
})
