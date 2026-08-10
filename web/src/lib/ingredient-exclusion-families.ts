import type { Ingredient } from "@/types/database"
import {
  resolveShoppingIngredientSemantics,
  shoppingExclusionFamily,
} from './shopping-ingredient-semantics'

export type IngredientExclusionFamily = "salt" | "black-pepper"

export type IngredientExclusionSettings = {
  exclude_salt_variants: boolean
  exclude_black_pepper_variants: boolean
}

export const INGREDIENT_EXCLUSION_REASONS = {
  salt: "Salt variants",
  "black-pepper": "Black pepper variants",
} as const satisfies Record<IngredientExclusionFamily, string>

export function matchIngredientExclusionFamily(
  ingredient: Ingredient
): IngredientExclusionFamily | null {
  if (ingredient.alternatives?.some((alternative) => alternative.trim())) {
    return null
  }

  const itemEvidence = ingredient.item.toLowerCase().trim().replace(/\s+/g, ' ')
  const modifierEvidence = ingredient.modifier
    ?.toLowerCase().trim().replace(/\s+/g, ' ')
  if (modifierEvidence && modifierEvidence !== 'to taste') return null

  const semantics = resolveShoppingIngredientSemantics({
    item: ingredient.item,
    unit: ingredient.unit,
    modifier: ingredient.modifier,
  })
  const family = shoppingExclusionFamily(semantics)
  if (!family) return null

  const structurallySupported = itemEvidence === semantics.purchaseKey ||
    itemEvidence === `${semantics.purchaseKey} to taste` ||
    (family === 'salt' && itemEvidence === `pinch of ${semantics.purchaseKey}`)
  return structurallySupported ? family : null
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
