import { hasIngredientAmount, parseIngredientLine } from "@/lib/recipe-parser"
import type { Ingredient } from "@/types/database"
import { normalizeItemName, normalizeUnit } from "@/lib/shopping-list-normalization"
import { WHOLE_COUNT_UNIT } from "@/lib/ingredient-units"

export type IngredientValidationIssue =
  | "missing-item"
  | "unit-without-amount"
  | "amount-without-unit"

export interface IngredientDuplicateGroup {
  key: string
  type: "exact" | "near"
  canonicalItem: string
  rowIndexes: number[]
}

export interface IngredientDuplicateAnalysis {
  exactGroups: IngredientDuplicateGroup[]
  nearGroups: IngredientDuplicateGroup[]
  rowWarnings: Record<number, string[]>
}

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
  const hasAmount = hasIngredientAmount(ingredient.amount)

  if (!isIngredientRowTouched(ingredient)) {
    return issues
  }

  if (!ingredient.item || !ingredient.item.trim()) {
    issues.push("missing-item")
  }

  if (ingredient.unit && ingredient.unit.trim() && !hasAmount) {
    issues.push("unit-without-amount")
  }

  if (
    hasAmount &&
    !ingredient.unit?.trim() &&
    !ingredient.item?.trim()
  ) {
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
    let fixedIngredient = ingredient
    if (
      ingredient.item &&
      ingredient.amount === null &&
      !ingredient.unit.trim() &&
      !ingredient.modifier?.trim()
    ) {
      const parsed = parseIngredientLine(ingredient.item)

      if (parsed.item && parsed.item !== ingredient.item) {
        fixedIngredient = {
          ...ingredient,
          amount: parsed.amount !== null ? parsed.amount : ingredient.amount,
          unit: parsed.unit || ingredient.unit,
          item: parsed.item,
          modifier: parsed.modifier || ingredient.modifier,
        }
      }
    }

    if (
      fixedIngredient.item?.trim() &&
      hasIngredientAmount(fixedIngredient.amount) &&
      !fixedIngredient.unit?.trim()
    ) {
      fixedIngredient = { ...fixedIngredient, unit: WHOLE_COUNT_UNIT }
    }

    const issues = validateIngredient(fixedIngredient)

    if (
      issues.includes("unit-without-amount") &&
      !hasIngredientAmount(fixedIngredient.amount)
    ) {
      return { ...fixedIngredient, amount: 1 }
    }

    return fixedIngredient
  })

  const fixedCount = fixedIngredients.filter((ingredient, index) => {
    return JSON.stringify(ingredient) !== JSON.stringify(ingredients[index])
  }).length

  return {
    ingredients: fixedIngredients,
    fixedCount,
  }
}

export function analyzeIngredientDuplicates(
  ingredients: Ingredient[]
): IngredientDuplicateAnalysis {
  const rowWarnings: Record<number, string[]> = {}
  const exactMap = new Map<string, number[]>()
  const canonicalMap = new Map<string, number[]>()

  ingredients.forEach((ingredient, index) => {
    if (!ingredient.item.trim()) return

    const exactKey = createExactDuplicateKey(ingredient)
    const canonicalKey = createCanonicalNearDuplicateKey(ingredient)

    if (exactKey) {
      exactMap.set(exactKey, [...(exactMap.get(exactKey) || []), index])
    }

    if (canonicalKey) {
      canonicalMap.set(canonicalKey, [...(canonicalMap.get(canonicalKey) || []), index])
    }
  })

  const exactGroups = Array.from(exactMap.entries())
    .filter(([, rowIndexes]) => rowIndexes.length > 1)
    .map(([key, rowIndexes]) => ({
      key,
      type: "exact" as const,
      canonicalItem: normalizeItemName(ingredients[rowIndexes[0]].item),
      rowIndexes,
    }))

  const rowsInExactGroups = new Set(exactGroups.flatMap((group) => group.rowIndexes))

  exactGroups.forEach((group) => {
    const firstIndex = group.rowIndexes[0]
    group.rowIndexes.slice(1).forEach((rowIndex) => {
      appendRowWarning(
        rowWarnings,
        rowIndex,
        `Exact duplicate of row ${firstIndex + 1}`
      )
    })
  })

  const nearGroups = Array.from(canonicalMap.entries())
    .map(([key, rowIndexes]) => ({
      key,
      rowIndexes: rowIndexes.filter((rowIndex) => !rowsInExactGroups.has(rowIndex)),
    }))
    .filter((group) => group.rowIndexes.length > 1)
    .filter((group) => hasLikelyNamingVariant(group.rowIndexes, ingredients))
    .map(({ key, rowIndexes }) => ({
      key,
      type: "near" as const,
      canonicalItem: key.split("|").pop() || key,
      rowIndexes,
    }))

  nearGroups.forEach((group) => {
    const firstIndex = group.rowIndexes[0]
    group.rowIndexes.slice(1).forEach((rowIndex) => {
      appendRowWarning(
        rowWarnings,
        rowIndex,
        `Possible duplicate of row ${firstIndex + 1}`
      )
    })
  })

  return {
    exactGroups,
    nearGroups,
    rowWarnings,
  }
}

export function removeExactDuplicateIngredients(ingredients: Ingredient[]): {
  ingredients: Ingredient[]
  removedCount: number
} {
  const seen = new Set<string>()
  let removedCount = 0

  const dedupedIngredients = ingredients.filter((ingredient) => {
    const exactKey = createExactDuplicateKey(ingredient)
    if (!exactKey) {
      return true
    }

    if (seen.has(exactKey)) {
      removedCount += 1
      return false
    }

    seen.add(exactKey)
    return true
  })

  return {
    ingredients: dedupedIngredients,
    removedCount,
  }
}

function appendRowWarning(
  rowWarnings: Record<number, string[]>,
  rowIndex: number,
  message: string
) {
  rowWarnings[rowIndex] = [...(rowWarnings[rowIndex] || []), message]
}

function createExactDuplicateKey(ingredient: Ingredient): string | null {
  const normalizedItem = normalizeText(ingredient.item)
  if (!normalizedItem) return null

  const groupKey = normalizeText(ingredient.groupLabel)
  const amountKey = ingredient.amount === null ? "" : ingredient.amount.toString()
  const unitKey = normalizeUnit(ingredient.unit || "")
  const modifierKey = normalizeText(ingredient.modifier)

  return `${groupKey}|${normalizedItem}|${amountKey}|${unitKey}|${modifierKey}`
}

function createCanonicalNearDuplicateKey(ingredient: Ingredient): string | null {
  const normalizedItem = normalizeItemName(ingredient.item)
  const groupKey = normalizeText(ingredient.groupLabel)
  return normalizedItem ? `${groupKey}|${normalizedItem}` : null
}

function hasLikelyNamingVariant(rowIndexes: number[], ingredients: Ingredient[]): boolean {
  const itemNames = new Set(
    rowIndexes.map((rowIndex) => normalizeText(ingredients[rowIndex].item))
  )

  if (itemNames.size < 2) {
    return false
  }

  return true
}

function normalizeText(value?: string | null): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ")
}
