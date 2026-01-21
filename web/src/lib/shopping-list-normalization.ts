/**
 * Unit normalization utilities for shopping list
 * Ensures consistent unit representation across the system
 */

/**
 * Normalize a unit string to its canonical lowercase form
 * Maps common variations (e.g., "TBSP", "tablespoon", "tablespoons") to canonical form (e.g., "tbsp")
 */
export function normalizeUnit(unit: string): string {
  if (!unit) return ""
  
  // 1. Trim and lowercase
  let normalized = unit.toLowerCase().trim()
  
  // 2. Map common variations to canonical form
  // Based on UNIT_CONVERSIONS from unit-conversion.ts
  const unitMap: Record<string, string> = {
    // Volume units
    'milliliter': 'ml',
    'milliliters': 'ml',
    'liter': 'l',
    'liters': 'l',
    'teaspoon': 'tsp',
    'teaspoons': 'tsp',
    'tablespoon': 'tbsp',
    'tablespoons': 'tbsp',
    'cup': 'cup',
    'cups': 'cup',
    'fluid ounce': 'fl oz',
    'fluid ounces': 'fl oz',
    'pint': 'pint',
    'pints': 'pint',
    'quart': 'quart',
    'quarts': 'quart',
    'gallon': 'gallon',
    'gallons': 'gallon',
    
    // Weight units
    'gram': 'g',
    'grams': 'g',
    'kilogram': 'kg',
    'kilograms': 'kg',
    'ounce': 'oz',
    'ounces': 'oz',
    'pound': 'lb',
    'pounds': 'lb',
    
    // Count units - normalize to empty string for consistency
    'piece': '',
    'pieces': '',
    'whole': '',
    'clove': '',
    'cloves': '',
    'slice': '',
    'slices': '',
    'can': '',
    'cans': '',
    'bunch': '',
    'bunches': '',
    'head': '',
    'heads': '',
    'stalk': '',
    'stalks': '',
    'sprig': '',
    'sprigs': '',
    'package': '',
    'packages': '',
    'bag': '',
    'bags': '',
    'box': '',
    'boxes': '',
    'jar': '',
    'jars': '',
    'bottle': '',
    'bottles': '',
    'count': '', // Also normalize 'count' itself
  }
  
  // Use nullish coalescing to handle empty string mappings correctly
  return unitMap[normalized] ?? normalized
}

/**
 * Normalize an item name (lowercase, trimmed)
 */
export function normalizeItemName(item: string): string {
  return item.toLowerCase().trim()
}

/**
 * Create a stable key for merging items (normalized item name + normalized unit)
 */
export function createItemKey(item: string, unit: string): string {
  return `${normalizeItemName(item)}|${normalizeUnit(unit)}`
}
