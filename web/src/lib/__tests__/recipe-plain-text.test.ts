import { describe, expect, it } from 'vitest'
import { readableRecipeQuantity, recipePlainText } from '../recipe-plain-text'
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures'
import { parseRecipeText } from '../recipe-parser'

describe('recipe plain text and replacement coverage', () => {
  it('expands standalone, mixed, ranged and package fractions', () => {
    expect(readableRecipeQuantity('½–1½ cups; 2¾ (14½ oz) cans')).toBe('1/2–1 1/2 cups; 2 3/4 (14 1/2 oz) cans')
  })

  it('copies selected quantities with all sections, preparation, alternatives, times and notes', () => {
    const recipe = canonicalizeRecipeFixture({
      name: 'Rice', category: 'Dinner', servings: 4, prep_time_minutes: 10,
      ingredientSections: [{ label: 'Sauce', ingredients: [{ item: 'onion', amount: 0.5, unit: 'cup', modifier: 'chopped', alternatives: ['shallot'] }] }],
      instructionSections: [{ label: 'Cook', steps: ['Mix.', 'Cook.'] }], notes: ['Keep chilled.'],
    })
    const snapshot = structuredClone(recipe)
    expect(recipePlainText(recipe, 8)).toBe('Rice\nYield: 8 servings\nCategory: Dinner\nPrep time: 10 min\n\nIngredients:\nSauce:\n1 cup onion, chopped (or shallot)\n\nInstructions:\nCook:\n1. Mix.\n2. Cook.\n\nNotes:\n- Keep chilled.')
    expect(recipe).toEqual(snapshot)
  })

  it.each([
    ['extra preamble', 'Rice\nKeep overnight.\nIngredients:\n1 cup rice\nInstructions:\nCook.'],
    ['unsupported section', '# Rice\n## Ingredients\n1 cup rice\n## Instructions\nCook.\n## Nutrition\nProtein 10g'],
    ['metadata in a section', 'Rice\nIngredients:\n1 cup rice\nInstructions:\nCook.\nPrep time: 10 min'],
    ['invalid time', 'Rice\nPrep time: overnight\nIngredients:\n1 cup rice\nInstructions:\nCook.'],
    ['partial duration', 'Rice\nPrep time: 10 min plus chilling\nIngredients:\n1 cup rice\nInstructions:\nCook.'],
    ['empty group', 'Rice\nIngredients:\nEmpty sauce:\nMain:\n1 cup rice\nInstructions:\nCook.'],
    ['overwritten metadata', 'Rice\nYield: 4 servings\nYield: 6 servings\nIngredients:\n1 cup rice\nInstructions:\nCook.'],
    ['inferred legacy structure', 'Rice\n1 cup rice\nCook it.'],
  ])('reports content loss for %s without discarding source diagnostics', (_, text) => {
    expect(parseRecipeText(text).unparsedContent?.length).toBeGreaterThan(0)
  })

  it('accepts complete conventional and Markdown recipes', () => {
    for (const text of ['Rice\nYield: 4 servings\nIngredients:\n1/2 cup rice\nInstructions:\nCook.\nNotes:\nKeep chilled.', '# Rice\nYield: 4 servings\n## Ingredients\n### Base\n- 1/2 cup rice\n## Instructions\n1. Cook.\n## Notes\n- Keep chilled.']) {
      expect(parseRecipeText(text).unparsedContent).toEqual([])
    }
  })

  it.each([
    ['Prep time: overnight', 'Preparation time: 20 min'],
    ['Prep time: 10 min', 'Preparation time: 20 min'],
    ['Cooking time: 10 min', 'Cook time: 20 min'],
    ['**Prep time:** overnight', '**Preparation time**: 20 min'],
    ['Serves 4', 'Yield: 6 servings'],
    ['Makes 4 servings', 'Servings 6'],
    ['# Rice', 'Title: Chicken'],
    ['Title: Chicken', '# Rice'],
    ['# Rice', '**Name:** Chicken'],
    ['Category: dinner', '**Category:** lunch'],
  ])('reports both conflicting consumed values: %s / %s', (first, second) => {
    const parsed = parseRecipeText(`${first}\n${second}\nIngredients:\n1 cup rice\nInstructions:\nCook.`)
    expect(parsed.unparsedContent).toEqual(expect.arrayContaining([first, second]))
  })

  it.each([
    'Rice\nPreparation time: 20 min\nCooking time: 10 min\nServes 4',
    '# Rice\nTitle: Rice\nPrep time: 20 min\nPreparation time: 20 min',
    '# Rice\n**Name:** Rice\n**Preparation time:** 20 min\n**Servings:** 4',
    'Rice\nServes 4\nYield 4',
  ])('accepts represented, nonconflicting metadata: %s', (preamble) => {
    expect(parseRecipeText(`${preamble}\nIngredients:\n1 cup rice\nInstructions:\nCook.`).unparsedContent).toEqual([])
  })
})
