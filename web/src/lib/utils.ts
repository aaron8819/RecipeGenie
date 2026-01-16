import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Common fraction mappings from decimal to Unicode fraction characters.
 * Keys are rounded to 3 decimal places to handle floating point precision.
 */
const FRACTION_MAP: Record<number, string> = {
  0.125: "⅛",
  0.25: "¼",
  0.333: "⅓",
  0.375: "⅜",
  0.5: "½",
  0.625: "⅝",
  0.667: "⅔",
  0.75: "¾",
  0.875: "⅞",
}

/**
 * Converts a decimal number to a display string with Unicode fractions.
 * 
 * Examples:
 *   0.5 → "½"
 *   1.5 → "1½"
 *   2 → "2"
 *   0.25 → "¼"
 *   1.333 → "1⅓"
 *   0.7 → "0.7" (unknown fractions kept as decimal)
 *   null → ""
 * 
 * @param value - The numeric value to convert
 * @returns A string with Unicode fractions where applicable
 */
export function toFraction(value: number | null | undefined): string {
  // Handle null/undefined/zero
  if (value === null || value === undefined) return ""
  if (value === 0) return "0"

  // Handle negative numbers (unlikely for recipes, but be safe)
  const isNegative = value < 0
  const absValue = Math.abs(value)

  // Split into whole and decimal parts
  const whole = Math.floor(absValue)
  const decimal = absValue - whole

  // Round decimal to 3 places to handle floating point precision (e.g., 0.33333333 → 0.333)
  const roundedDecimal = Math.round(decimal * 1000) / 1000

  // Look up fraction character
  const fractionChar = FRACTION_MAP[roundedDecimal]

  // Build result string
  let result: string
  if (roundedDecimal === 0) {
    // Whole number only
    result = whole.toString()
  } else if (fractionChar) {
    // Known fraction
    result = whole > 0 ? `${whole}${fractionChar}` : fractionChar
  } else {
    // Unknown fraction - keep as decimal, rounded nicely
    const rounded = Math.round(absValue * 100) / 100
    result = rounded.toString()
  }

  return isNegative ? `-${result}` : result
}
