import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Common fraction mappings from decimal to Unicode fraction characters.
 * Uses actual mathematical fractions for precise matching.
 */
const FRACTIONS: Array<{ value: number; char: string }> = [
  { value: 0.125, char: "⅛" },
  { value: 0.25, char: "¼" },
  { value: 1/3, char: "⅓" },   // 0.3333...
  { value: 0.375, char: "⅜" },
  { value: 0.5, char: "½" },
  { value: 0.625, char: "⅝" },
  { value: 2/3, char: "⅔" },   // 0.6666...
  { value: 0.75, char: "¾" },
  { value: 0.875, char: "⅞" },
]

// Tolerance for matching fractions (handles 0.33 matching 1/3, 0.67 matching 2/3, etc.)
const FRACTION_TOLERANCE = 0.02

/**
 * Converts a decimal number to a display string with Unicode fractions.
 * 
 * Examples:
 *   0.5 → "½"
 *   1.5 → "1½"
 *   2 → "2"
 *   0.25 → "¼"
 *   1.333 → "1⅓"
 *   0.33 → "⅓"  (tolerance-based matching)
 *   0.67 → "⅔"  (tolerance-based matching)
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

  // Find matching fraction using tolerance
  let fractionChar: string | undefined
  for (const frac of FRACTIONS) {
    if (Math.abs(decimal - frac.value) < FRACTION_TOLERANCE) {
      fractionChar = frac.char
      break
    }
  }

  // Build result string
  let result: string
  if (decimal < FRACTION_TOLERANCE) {
    // Whole number only (decimal is effectively 0)
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
