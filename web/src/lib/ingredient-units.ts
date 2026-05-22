export const WHOLE_COUNT_UNIT = "count"
export const WHOLE_COUNT_UNIT_LABEL = "whole/count"

const WHOLE_COUNT_UNIT_ALIASES = new Set([
  WHOLE_COUNT_UNIT,
  "counts",
  "whole",
  "wholes",
  "whole/count",
  "whole item",
  "whole items",
])

function normalizeUnitText(unit?: string | null): string {
  return (unit || "").replace(/\s+/g, " ").trim().toLowerCase()
}

export function normalizeWholeCountUnit(unit?: string | null): string | null {
  return WHOLE_COUNT_UNIT_ALIASES.has(normalizeUnitText(unit))
    ? WHOLE_COUNT_UNIT
    : null
}

export function isWholeCountUnit(unit?: string | null): boolean {
  return normalizeWholeCountUnit(unit) === WHOLE_COUNT_UNIT
}

export function getIngredientDisplayUnit(unit?: string | null): string {
  if (isWholeCountUnit(unit)) {
    return ""
  }

  return (unit || "").trim()
}
