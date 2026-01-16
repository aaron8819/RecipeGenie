/**
 * Unit conversion utilities for shopping list ingredient merging
 */

// Unit families - units that can be converted to each other
export type UnitFamily = "volume" | "weight" | "count" | "unknown"

// Base units for each family (everything converts to these)
const BASE_UNITS: Record<UnitFamily, string> = {
  volume: "ml",
  weight: "g",
  count: "count",
  unknown: "unknown",
}

// Conversion factors to base unit
// Volume: convert to ml
// Weight: convert to grams
const UNIT_CONVERSIONS: Record<string, { family: UnitFamily; toBase: number }> = {
  // Volume units → ml
  "ml": { family: "volume", toBase: 1 },
  "milliliter": { family: "volume", toBase: 1 },
  "milliliters": { family: "volume", toBase: 1 },
  "l": { family: "volume", toBase: 1000 },
  "liter": { family: "volume", toBase: 1000 },
  "liters": { family: "volume", toBase: 1000 },
  "tsp": { family: "volume", toBase: 4.929 },
  "teaspoon": { family: "volume", toBase: 4.929 },
  "teaspoons": { family: "volume", toBase: 4.929 },
  "tbsp": { family: "volume", toBase: 14.787 },
  "tablespoon": { family: "volume", toBase: 14.787 },
  "tablespoons": { family: "volume", toBase: 14.787 },
  "cup": { family: "volume", toBase: 236.588 },
  "cups": { family: "volume", toBase: 236.588 },
  "fl oz": { family: "volume", toBase: 29.574 },
  "fluid ounce": { family: "volume", toBase: 29.574 },
  "fluid ounces": { family: "volume", toBase: 29.574 },
  "pint": { family: "volume", toBase: 473.176 },
  "pints": { family: "volume", toBase: 473.176 },
  "quart": { family: "volume", toBase: 946.353 },
  "quarts": { family: "volume", toBase: 946.353 },
  "gallon": { family: "volume", toBase: 3785.41 },
  "gallons": { family: "volume", toBase: 3785.41 },

  // Weight units → grams
  "g": { family: "weight", toBase: 1 },
  "gram": { family: "weight", toBase: 1 },
  "grams": { family: "weight", toBase: 1 },
  "kg": { family: "weight", toBase: 1000 },
  "kilogram": { family: "weight", toBase: 1000 },
  "kilograms": { family: "weight", toBase: 1000 },
  "oz": { family: "weight", toBase: 28.3495 },
  "ounce": { family: "weight", toBase: 28.3495 },
  "ounces": { family: "weight", toBase: 28.3495 },
  "lb": { family: "weight", toBase: 453.592 },
  "lbs": { family: "weight", toBase: 453.592 },
  "pound": { family: "weight", toBase: 453.592 },
  "pounds": { family: "weight", toBase: 453.592 },

  // Count units
  "": { family: "count", toBase: 1 },
  "count": { family: "count", toBase: 1 },
  "piece": { family: "count", toBase: 1 },
  "pieces": { family: "count", toBase: 1 },
  "whole": { family: "count", toBase: 1 },
  "clove": { family: "count", toBase: 1 },
  "cloves": { family: "count", toBase: 1 },
  "slice": { family: "count", toBase: 1 },
  "slices": { family: "count", toBase: 1 },
  "can": { family: "count", toBase: 1 },
  "cans": { family: "count", toBase: 1 },
  "bunch": { family: "count", toBase: 1 },
  "bunches": { family: "count", toBase: 1 },
  "head": { family: "count", toBase: 1 },
  "heads": { family: "count", toBase: 1 },
  "stalk": { family: "count", toBase: 1 },
  "stalks": { family: "count", toBase: 1 },
  "sprig": { family: "count", toBase: 1 },
  "sprigs": { family: "count", toBase: 1 },
  "package": { family: "count", toBase: 1 },
  "packages": { family: "count", toBase: 1 },
  "bag": { family: "count", toBase: 1 },
  "bags": { family: "count", toBase: 1 },
  "box": { family: "count", toBase: 1 },
  "boxes": { family: "count", toBase: 1 },
  "jar": { family: "count", toBase: 1 },
  "jars": { family: "count", toBase: 1 },
  "bottle": { family: "count", toBase: 1 },
  "bottles": { family: "count", toBase: 1 },
}

// Preferred display units for each family (from largest to smallest)
const PREFERRED_UNITS: Record<UnitFamily, Array<{ unit: string; minValue: number }>> = {
  volume: [
    { unit: "gallon", minValue: 3785.41 },    // 1 gallon
    { unit: "quart", minValue: 946.353 },     // 1 quart
    { unit: "cup", minValue: 59.147 },        // 1/4 cup
    { unit: "tbsp", minValue: 14.787 },       // 1 tbsp
    { unit: "tsp", minValue: 4.929 },         // 1 tsp
    { unit: "ml", minValue: 0 },              // fallback
  ],
  weight: [
    { unit: "lb", minValue: 226.796 },        // 0.5 lb
    { unit: "oz", minValue: 28.3495 },        // 1 oz
    { unit: "g", minValue: 0 },               // fallback
  ],
  count: [
    { unit: "", minValue: 0 },
  ],
  unknown: [
    { unit: "", minValue: 0 },
  ],
}

/**
 * Get the unit family for a given unit string
 */
export function getUnitFamily(unit: string): UnitFamily {
  const normalized = unit.toLowerCase().trim()
  const conversion = UNIT_CONVERSIONS[normalized]
  return conversion?.family || "unknown"
}

/**
 * Check if two units are in the same family and can be merged
 */
export function areUnitsCompatible(unit1: string, unit2: string): boolean {
  const family1 = getUnitFamily(unit1)
  const family2 = getUnitFamily(unit2)
  
  // Unknown units are not compatible with anything (except identical units)
  if (family1 === "unknown" || family2 === "unknown") {
    return unit1.toLowerCase().trim() === unit2.toLowerCase().trim()
  }
  
  return family1 === family2
}

/**
 * Convert an amount from one unit to the base unit of its family
 */
export function convertToBase(amount: number, unit: string): { value: number; family: UnitFamily } | null {
  const normalized = unit.toLowerCase().trim()
  const conversion = UNIT_CONVERSIONS[normalized]
  
  if (!conversion) {
    return null
  }
  
  return {
    value: amount * conversion.toBase,
    family: conversion.family,
  }
}

/**
 * Convert an amount from base unit to a target unit
 */
export function convertFromBase(baseValue: number, targetUnit: string): number | null {
  const normalized = targetUnit.toLowerCase().trim()
  const conversion = UNIT_CONVERSIONS[normalized]
  
  if (!conversion) {
    return null
  }
  
  return baseValue / conversion.toBase
}

/**
 * Find the best display unit for a given base value in a family
 */
export function getBestDisplayUnit(baseValue: number, family: UnitFamily): { unit: string; value: number } {
  const preferred = PREFERRED_UNITS[family]
  
  for (const { unit, minValue } of preferred) {
    if (baseValue >= minValue) {
      const conversion = UNIT_CONVERSIONS[unit] || UNIT_CONVERSIONS[""]
      const displayValue = baseValue / conversion.toBase
      return { unit, value: displayValue }
    }
  }
  
  // Fallback - should not reach here
  return { unit: "", value: baseValue }
}

/**
 * Merge two amounts with potentially different units
 * Returns merged amount if compatible, or null if units cannot be merged
 */
export function mergeAmounts(
  amount1: number | null,
  unit1: string,
  amount2: number | null,
  unit2: string
): { amount: number; unit: string } | null {
  // If either amount is null/0, just return the other
  if (!amount1) {
    return amount2 ? { amount: amount2, unit: unit2 } : null
  }
  if (!amount2) {
    return { amount: amount1, unit: unit1 }
  }
  
  // Same unit - simple addition
  if (unit1.toLowerCase().trim() === unit2.toLowerCase().trim()) {
    return { amount: amount1 + amount2, unit: unit1 }
  }
  
  // Check if units are compatible
  if (!areUnitsCompatible(unit1, unit2)) {
    return null // Cannot merge - different families
  }
  
  // Convert both to base, add, then convert to best display unit
  const base1 = convertToBase(amount1, unit1)
  const base2 = convertToBase(amount2, unit2)
  
  if (!base1 || !base2) {
    return null
  }
  
  const totalBase = base1.value + base2.value
  const result = getBestDisplayUnit(totalBase, base1.family)
  
  return { amount: result.value, unit: result.unit }
}

/**
 * Round a number to a reasonable precision for display
 */
export function roundForDisplay(value: number): number {
  if (value >= 10) {
    return Math.round(value)
  } else if (value >= 1) {
    return Math.round(value * 4) / 4 // Round to nearest 0.25
  } else {
    return Math.round(value * 8) / 8 // Round to nearest 0.125
  }
}
