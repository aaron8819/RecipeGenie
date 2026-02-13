/**
 * Sanitizes a recipe name to create a valid storage key or database ID
 * Removes special characters, truncates length, and ensures URL-safe format
 */
export function sanitizeRecipeNameForStorage(name: string): string {
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
