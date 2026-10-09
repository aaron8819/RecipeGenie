import type { Ingredient, Recipe } from '@/types/database'
import { formatRecipeQuantity, getScalingBasis, getSelectedYieldText } from './recipe-quantity'
import { formatRecipeTime, normalizeRecipeNotes } from './recipe-structure'

const FRACTIONS: Record<string, string> = {
  '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10',
  '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
}

// Full-size digits stay readable on phones, including authored mixed fractions.
export function readableRecipeQuantity(text: string): string {
  return text.replace(/(\d)?([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g,
    (_, whole: string | undefined, fraction: string) =>
      `${whole ? `${whole} ` : ''}${FRACTIONS[fraction]}`)
}

export function recipeIngredientText(ingredient: Ingredient, basis: number, yieldValue: number): string {
  const quantity = readableRecipeQuantity(formatRecipeQuantity(ingredient, basis, yieldValue).text)
  return [quantity, ingredient.item].filter(Boolean).join(' ') +
    (ingredient.modifier ? `, ${ingredient.modifier}` : '') +
    (ingredient.alternatives?.length ? ` (or ${ingredient.alternatives.join(' or ')})` : '')
}

export function recipePlainText(recipe: Recipe, selectedYield = getScalingBasis(recipe.yield_metadata, recipe.servings)): string {
  const basis = getScalingBasis(recipe.yield_metadata, recipe.servings)
  const lines = [recipe.name, `Yield: ${getSelectedYieldText(recipe.yield_metadata, recipe.servings, selectedYield)}`,
    `Category: ${recipe.category}`]
  if (recipe.tags?.length) lines.push(`Tags: ${recipe.tags.join(', ')}`)
  for (const [label, value] of [['Prep', recipe.prep_time_minutes], ['Cook', recipe.cook_time_minutes], ['Total', recipe.total_time_minutes]] as const) {
    if (value != null) lines.push(`${label} time: ${formatRecipeTime(value)}`)
  }
  lines.push('', 'Ingredients:')
  for (const section of recipe.ingredientSections) {
    if (section.label) lines.push(`${section.label}:`)
    lines.push(...section.ingredients.map(ingredient => recipeIngredientText(ingredient, basis, selectedYield)))
  }
  lines.push('', 'Instructions:')
  let number = 0
  for (const section of recipe.instructionSections) {
    if (section.label) lines.push(`${section.label}:`)
    lines.push(...section.steps.map(step => `${++number}. ${step}`))
  }
  const notes = normalizeRecipeNotes(recipe.notes)
  if (notes.length) lines.push('', 'Notes:', ...notes.map(note => `- ${note}`))
  return lines.join('\n')
}
