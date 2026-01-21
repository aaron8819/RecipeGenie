import { describe, it, expect } from 'vitest'
import { normalizeUnit, normalizeItemName, createItemKey } from '../shopping-list-normalization'

describe('normalizeUnit', () => {
  it('should normalize common volume units', () => {
    expect(normalizeUnit('TBSP')).toBe('tbsp')
    expect(normalizeUnit('tablespoon')).toBe('tbsp')
    expect(normalizeUnit('tablespoons')).toBe('tbsp')
    expect(normalizeUnit('TSP')).toBe('tsp')
    expect(normalizeUnit('teaspoon')).toBe('tsp')
    expect(normalizeUnit('teaspoons')).toBe('tsp')
    expect(normalizeUnit('CUP')).toBe('cup')
    expect(normalizeUnit('cups')).toBe('cup')
    expect(normalizeUnit('ml')).toBe('ml')
    expect(normalizeUnit('milliliter')).toBe('ml')
    expect(normalizeUnit('milliliters')).toBe('ml')
  })

  it('should normalize common weight units', () => {
    expect(normalizeUnit('OZ')).toBe('oz')
    expect(normalizeUnit('ounce')).toBe('oz')
    expect(normalizeUnit('ounces')).toBe('oz')
    expect(normalizeUnit('LB')).toBe('lb')
    expect(normalizeUnit('pound')).toBe('lb')
    expect(normalizeUnit('pounds')).toBe('lb')
    expect(normalizeUnit('G')).toBe('g')
    expect(normalizeUnit('gram')).toBe('g')
    expect(normalizeUnit('grams')).toBe('g')
  })

  it('should normalize count units to empty string', () => {
    expect(normalizeUnit('piece')).toBe('')
    expect(normalizeUnit('pieces')).toBe('')
    expect(normalizeUnit('clove')).toBe('')
    expect(normalizeUnit('cloves')).toBe('')
    expect(normalizeUnit('can')).toBe('')
    expect(normalizeUnit('cans')).toBe('')
  })

  it('should handle empty strings', () => {
    expect(normalizeUnit('')).toBe('')
    expect(normalizeUnit('   ')).toBe('')
  })

  it('should handle unknown units', () => {
    expect(normalizeUnit('unknown-unit')).toBe('unknown-unit')
    expect(normalizeUnit('custom')).toBe('custom')
  })

  it('should trim whitespace', () => {
    expect(normalizeUnit('  tbsp  ')).toBe('tbsp')
    expect(normalizeUnit('  CUP  ')).toBe('cup')
  })

  it('should handle case variations', () => {
    expect(normalizeUnit('Tbsp')).toBe('tbsp')
    expect(normalizeUnit('Tsp')).toBe('tsp')
    expect(normalizeUnit('Cup')).toBe('cup')
  })
})

describe('normalizeItemName', () => {
  it('should lowercase and trim item names', () => {
    expect(normalizeItemName('Chicken Breast')).toBe('chicken breast')
    expect(normalizeItemName('  ONIONS  ')).toBe('onions')
    expect(normalizeItemName('Garlic')).toBe('garlic')
  })

  it('should handle empty strings', () => {
    expect(normalizeItemName('')).toBe('')
    expect(normalizeItemName('   ')).toBe('')
  })
})

describe('createItemKey', () => {
  it('should create normalized keys', () => {
    expect(createItemKey('Chicken', 'TBSP')).toBe('chicken|tbsp')
    expect(createItemKey('  Onions  ', '  CUP  ')).toBe('onions|cup')
    expect(createItemKey('Garlic', '')).toBe('garlic|')
  })
})
