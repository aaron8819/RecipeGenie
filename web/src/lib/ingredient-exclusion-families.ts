import type { Ingredient } from "@/types/database"

export type IngredientExclusionFamily = "salt" | "black-pepper"

export type IngredientExclusionSettings = {
  exclude_salt_variants: boolean
  exclude_black_pepper_variants: boolean
}

export const INGREDIENT_EXCLUSION_REASONS = {
  salt: "Salt variants",
  "black-pepper": "Black pepper variants",
} as const satisfies Record<IngredientExclusionFamily, string>

const FAMILY_ALIASES: Record<IngredientExclusionFamily, ReadonlySet<string>> = {
  salt: new Set(["salt", "kosher salt", "sea salt", "table salt"]),
  "black-pepper": new Set([
    "black pepper",
    "ground black pepper",
    "freshly ground black pepper",
    "cracked black pepper",
  ]),
}

function normalizeStructuredText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

export function matchIngredientExclusionFamily(
  ingredient: Ingredient
): IngredientExclusionFamily | null {
  if (ingredient.alternatives?.some((alternative) => alternative.trim())) {
    return null
  }

  const item = normalizeStructuredText(ingredient.item)
  const modifier = normalizeStructuredText(ingredient.modifier || "")
  if (modifier && modifier !== "to taste") return null

  const candidate = modifier === "to taste" ? `${item} to taste` : item
  const alias = candidate.endsWith(" to taste")
    ? candidate.slice(0, -" to taste".length)
    : candidate

  if (FAMILY_ALIASES.salt.has(alias)) return "salt"
  if (FAMILY_ALIASES["black-pepper"].has(alias)) return "black-pepper"
  return null
}

export function isIngredientExclusionEnabled(
  family: IngredientExclusionFamily,
  settings: IngredientExclusionSettings
): boolean {
  return family === "salt"
    ? settings.exclude_salt_variants
    : settings.exclude_black_pepper_variants
}

export function isIngredientExclusionReason(
  reason: string | undefined
): reason is (typeof INGREDIENT_EXCLUSION_REASONS)[IngredientExclusionFamily] {
  return reason === INGREDIENT_EXCLUSION_REASONS.salt ||
    reason === INGREDIENT_EXCLUSION_REASONS["black-pepper"]
}

export function matchesIngredientExclusionReason(
  ingredient: Ingredient,
  reason: string | undefined
): boolean {
  const family = matchIngredientExclusionFamily(ingredient)
  return family !== null && INGREDIENT_EXCLUSION_REASONS[family] === reason
}
