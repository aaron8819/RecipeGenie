import { describe, it, expect } from 'vitest'

/**
 * Sanitizes a recipe name to create a valid storage key
 * Removes special characters, truncates length, and ensures URL-safe format
 */
function sanitizeRecipeNameForStorage(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove apostrophes, quotes
    .replace(/['"`]/g, '')
    // Remove parentheses, brackets, braces
    .replace(/[()[\]{}]/g, '')
    // Replace spaces, underscores, and other separators with hyphens
    .replace(/[\s_]+/g, '-')
    // Remove commas, periods, and other punctuation (except hyphens)
    .replace(/[,;:.!?]/g, '')
    // Replace any other non-alphanumeric characters (except hyphens) with hyphens
    .replace(/[^a-z0-9-]/g, '-')
    // Collapse multiple hyphens into one
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Truncate to reasonable length (50 chars)
    .substring(0, 50)
    // Remove trailing hyphen if truncation created one
    .replace(/-+$/, '')
}

describe('sanitizeRecipeNameForStorage', () => {
  it('converts simple names to lowercase with hyphens', () => {
    expect(sanitizeRecipeNameForStorage('Chocolate Chip Cookies')).toBe(
      'chocolate-chip-cookies'
    )
  })

  it('removes apostrophes', () => {
    expect(sanitizeRecipeNameForStorage("Mom's Spaghetti")).toBe('moms-spaghetti')
  })

  it('removes parentheses and brackets', () => {
    expect(
      sanitizeRecipeNameForStorage('Bavarian Pretzels (Laugenbrezeln)')
    ).toBe('bavarian-pretzels-laugenbrezeln')
  })

  it('removes commas and periods', () => {
    expect(sanitizeRecipeNameForStorage('Soup, Salad, and Bread.')).toBe(
      'soup-salad-and-bread'
    )
  })

  it('handles the problematic pretzel recipe name', () => {
    const longName =
      "Here's a classic Bavarian-style soft pretzel recipe (Laugenbrezeln) that skips the traditional lye bath entirely. Instead, it uses a simple baking soda bath (the most common safe substitute for home cooks) to get that signature golden-brown crust, chewy texture, and authentic pretzel flavor. This version is adapted from popular German-inspired recipes and yields about 10–12 medium pretzels."
    const result = sanitizeRecipeNameForStorage(longName)

    // Should be sanitized and truncated
    expect(result).toBe(
      'heres-a-classic-bavarian-style-soft-pretzel-recipe'
    )
    // Should be exactly 50 chars or less
    expect(result.length).toBeLessThanOrEqual(50)
    // Should not contain any special characters except hyphens
    expect(result).toMatch(/^[a-z0-9-]+$/)
    // Should not start or end with hyphen
    expect(result).not.toMatch(/^-/)
    expect(result).not.toMatch(/-$/)
  })

  it('collapses multiple hyphens into one', () => {
    expect(sanitizeRecipeNameForStorage('Recipe -- with --- hyphens')).toBe(
      'recipe-with-hyphens'
    )
  })

  it('removes leading and trailing spaces/hyphens', () => {
    expect(sanitizeRecipeNameForStorage('  Recipe Name  ')).toBe('recipe-name')
    expect(sanitizeRecipeNameForStorage('- Recipe -')).toBe('recipe')
  })

  it('handles unicode and special characters', () => {
    // Unicode characters get replaced with hyphens, then collapsed
    expect(sanitizeRecipeNameForStorage('Crème Brûlée with café')).toBe(
      'cr-me-br-l-e-with-caf'
    )
  })

  it('truncates long names to 50 characters', () => {
    const longName =
      'This is an extremely long recipe name that should definitely be truncated'
    const result = sanitizeRecipeNameForStorage(longName)

    expect(result.length).toBeLessThanOrEqual(50)
    expect(result).toBe('this-is-an-extremely-long-recipe-name-that-should')
  })

  it('handles em dashes and en dashes', () => {
    expect(sanitizeRecipeNameForStorage('Recipe – with — dashes')).toBe(
      'recipe-with-dashes'
    )
  })

  it('handles empty or whitespace-only input', () => {
    expect(sanitizeRecipeNameForStorage('')).toBe('')
    expect(sanitizeRecipeNameForStorage('   ')).toBe('')
  })

  it('preserves numbers', () => {
    expect(sanitizeRecipeNameForStorage('7-Layer Dip 2.0')).toBe(
      '7-layer-dip-20'
    )
  })
})
