import { parseIngredientLine } from "@/lib/recipe-parser"
import type { Ingredient } from "@/types/database"

export type IngredientValidationIssue =
  | "missing-item"
  | "unit-without-amount"
  | "amount-without-unit"

export function isIngredientRowTouched(ingredient: Ingredient): boolean {
  return Boolean(
    ingredient.item?.trim() ||
      ingredient.unit?.trim() ||
      ingredient.modifier?.trim() ||
      ingredient.amount !== null
  )
}

export function validateIngredient(
  ingredient: Ingredient
): IngredientValidationIssue[] {
  const issues: IngredientValidationIssue[] = []

  if (!isIngredientRowTouched(ingredient)) {
    return issues
  }

  if (!ingredient.item || !ingredient.item.trim()) {
    issues.push("missing-item")
  }

  if (ingredient.unit && ingredient.unit.trim() && !ingredient.amount) {
    issues.push("unit-without-amount")
  }

  if (ingredient.amount && ingredient.amount > 0 && !ingredient.unit?.trim()) {
    issues.push("amount-without-unit")
  }

  return issues
}

export function countIngredientsWithIssues(ingredients: Ingredient[]): number {
  return ingredients.filter((ingredient) => validateIngredient(ingredient).length > 0).length
}

export function countBlockingIngredientIssues(ingredients: Ingredient[]): number {
  return ingredients.filter((ingredient) => {
    const issues = validateIngredient(ingredient)
    return issues.some(
      (issue) => issue === "missing-item" || issue === "unit-without-amount"
    )
  }).length
}

export function autoFixIngredients(ingredients: Ingredient[]): {
  ingredients: Ingredient[]
  fixedCount: number
} {
  const fixedIngredients = ingredients.map((ingredient) => {
    const issues = validateIngredient(ingredient)

    if (issues.length === 0) {
      return ingredient
    }

    if (
      ingredient.item &&
      (issues.includes("amount-without-unit") ||
        issues.includes("unit-without-amount"))
    ) {
      const parsed = parseIngredientLine(ingredient.item)

      if (parsed.item && parsed.item !== ingredient.item) {
        return {
          ...ingredient,
          amount: parsed.amount !== null ? parsed.amount : ingredient.amount,
          unit: parsed.unit || ingredient.unit,
          item: parsed.item,
          modifier: parsed.modifier || ingredient.modifier,
        }
      }
    }

    if (issues.includes("unit-without-amount") && !ingredient.amount) {
      return { ...ingredient, amount: 1 }
    }

    return ingredient
  })

  const fixedCount = fixedIngredients.filter((ingredient, index) => {
    const before = validateIngredient(ingredients[index]).length
    const after = validateIngredient(ingredient).length
    return after < before
  }).length

  return {
    ingredients: fixedIngredients,
    fixedCount,
  }
}
