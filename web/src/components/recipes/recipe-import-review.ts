import type { ParsedRecipe } from '@/lib/recipe-parser'
import type { Ingredient, RecipeInstructionGroup } from '@/types/database'

export type ImportReviewSection = 'details' | 'ingredients' | 'instructions'

export function countImportInstructionSteps(candidate: ParsedRecipe): number {
  if (candidate.instructionGroups?.length) {
    return candidate.instructionGroups.reduce(
      (total, group) => total + group.steps.filter((step) => step.trim()).length,
      0
    )
  }

  return candidate.instructions.filter((step) => step.trim()).length
}

export function canReviewImportedRecipe(
  candidate: ParsedRecipe | null
): boolean {
  return !!candidate &&
    candidate.ingredients.some((ingredient) => ingredient.item.trim()) &&
    countImportInstructionSteps(candidate) > 0
}

export function shouldConfirmCandidateReplacement(values: {
  appliedRawSource: string | null
  nextRawSource: string
  draftCorrected: boolean
}): boolean {
  return values.appliedRawSource !== null &&
    values.appliedRawSource !== values.nextRawSource &&
    values.draftCorrected
}

export function isImportWorkDirty(values: {
  rawSource: string
  importUrl: string
  hasParsedCandidate: boolean
  hasAppliedCandidate: boolean
}): boolean {
  return values.rawSource.trim().length > 0 ||
    values.importUrl.trim().length > 0 ||
    values.hasParsedCandidate ||
    values.hasAppliedCandidate
}

export function mapImportWarningToSection(
  warning: string
): ImportReviewSection {
  const normalized = warning.toLowerCase()

  if (normalized.includes('ingredient') || normalized.includes('amount')) {
    return 'ingredients'
  }

  if (
    normalized.includes('instruction') ||
    normalized.includes('direction') ||
    normalized.includes('step')
  ) {
    return 'instructions'
  }

  return 'details'
}

export function getInvalidImportReviewSection(values: {
  name: string
  category: string
  ingredients: Ingredient[]
  instructionGroups: RecipeInstructionGroup[]
  blockingIngredientIssues: number
}): ImportReviewSection | null {
  if (!values.name.trim() || !values.category) return 'details'
  if (
    !values.ingredients.some((ingredient) => ingredient.item.trim()) ||
    values.blockingIngredientIssues > 0
  ) {
    return 'ingredients'
  }
  if (
    !values.instructionGroups.some((group) =>
      group.steps.some((step) => step.trim())
    )
  ) {
    return 'instructions'
  }

  return null
}
