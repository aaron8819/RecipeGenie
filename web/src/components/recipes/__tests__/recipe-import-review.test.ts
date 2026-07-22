import { describe, expect, it } from 'vitest'
import type { ParsedRecipe } from '@/lib/recipe-parser'
import {
  canReviewImportedRecipe,
  getInvalidImportReviewSection,
  isImportWorkDirty,
  mapImportWarningToSection,
  shouldConfirmCandidateReplacement,
} from '../recipe-import-review'

function candidate(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    name: 'Soup',
    servings: 4,
    ingredients: [{ item: 'carrot', amount: 1, unit: '' }],
    instructions: ['Cook'],
    warnings: [],
    ...overrides,
  }
}

describe('mobile import review workflow', () => {
  it('treats raw source and an applied candidate as dirty import work', () => {
    expect(isImportWorkDirty({
      rawSource: 'Soup',
      importUrl: '',
      hasParsedCandidate: false,
      hasAppliedCandidate: false,
    })).toBe(true)
    expect(isImportWorkDirty({
      rawSource: '',
      importUrl: 'https://example.com/recipe',
      hasParsedCandidate: false,
      hasAppliedCandidate: false,
    })).toBe(true)
    expect(isImportWorkDirty({
      rawSource: '',
      importUrl: '',
      hasParsedCandidate: true,
      hasAppliedCandidate: false,
    })).toBe(true)
    expect(isImportWorkDirty({
      rawSource: '',
      importUrl: '',
      hasParsedCandidate: false,
      hasAppliedCandidate: true,
    })).toBe(true)
    expect(isImportWorkDirty({
      rawSource: '   ',
      importUrl: '   ',
      hasParsedCandidate: false,
      hasAppliedCandidate: false,
    })).toBe(false)
  })

  it('allows review only for structurally valid candidates', () => {
    expect(canReviewImportedRecipe(candidate())).toBe(true)
    expect(canReviewImportedRecipe(candidate({ ingredients: [] }))).toBe(false)
    expect(canReviewImportedRecipe(candidate({ instructions: [] }))).toBe(false)
    expect(canReviewImportedRecipe(null)).toBe(false)
  })

  it('requires confirmation only when changed source would replace corrections', () => {
    expect(shouldConfirmCandidateReplacement({
      appliedRawSource: 'old',
      nextRawSource: 'new',
      draftCorrected: true,
    })).toBe(true)
    expect(shouldConfirmCandidateReplacement({
      appliedRawSource: 'old',
      nextRawSource: 'old',
      draftCorrected: true,
    })).toBe(false)
    expect(shouldConfirmCandidateReplacement({
      appliedRawSource: 'old',
      nextRawSource: 'new',
      draftCorrected: false,
    })).toBe(false)
  })

  it('maps warnings to the review section that owns the correction', () => {
    expect(mapImportWarningToSection('Cook time needs review')).toBe('details')
    expect(mapImportWarningToSection('Ingredient has no amount')).toBe('ingredients')
    expect(mapImportWarningToSection('No instructions found')).toBe('instructions')
  })

  it('routes validation to the first affected review section', () => {
    const base = {
      name: 'Soup',
      category: 'Dinner',
      ingredients: [{ item: 'carrot', amount: 1, unit: '' }],
      instructionGroups: [{ steps: ['Cook'] }],
      blockingIngredientIssues: 0,
    }

    expect(getInvalidImportReviewSection({ ...base, name: '' })).toBe('details')
    expect(getInvalidImportReviewSection({ ...base, ingredients: [] })).toBe('ingredients')
    expect(getInvalidImportReviewSection({ ...base, instructionGroups: [] })).toBe('instructions')
    expect(getInvalidImportReviewSection(base)).toBeNull()
  })
})
