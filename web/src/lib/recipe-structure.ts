import type {
  CanonicalIngredient,
  Ingredient,
  IngredientSection,
  InstructionSection,
  RecipeInstructionGroup,
} from "@/types/database"
import {
  RECIPE_DATA_LIMITS,
  normalizeIngredient,
} from "@/lib/recipe-data-validation"

const CANONICAL_INGREDIENT_KEYS = new Set([
  "item",
  "amount",
  "unit",
  "quantityV1",
  "authoredUnit",
  "packageV1",
  "shoppingCategory",
  "modifier",
  "alternatives",
  "originalText",
])

type RecipeStructureField = "ingredientSections" | "instructionSections"

export type RecipeStructureValidationIssue = {
  field: RecipeStructureField
  code:
    | "invalid-top-level"
    | "too-many-sections"
    | "invalid-section"
    | "invalid-label"
    | "empty-section"
    | "too-many-items"
    | "invalid-ingredient"
    | "invalid-step"
}

export type RecipeStructureValidationResult =
  | { valid: true }
  | { valid: false; issue: RecipeStructureValidationIssue }

export function validateRecipeStructure(
  value: unknown
): RecipeStructureValidationResult {
  if (!isRecord(value)) {
    return invalid("ingredientSections", "invalid-top-level")
  }

  const ingredientResult = validateIngredientSections(value.ingredientSections)
  if (!ingredientResult.valid) return ingredientResult

  return validateInstructionSections(value.instructionSections)
}

export function flattenRecipeIngredients(
  sections: IngredientSection[]
): CanonicalIngredient[] {
  return sections.flatMap((section) => section.ingredients.map(cloneIngredient))
}

export function flattenRecipeInstructions(
  sections: InstructionSection[]
): string[] {
  return sections.flatMap((section) => [...section.steps])
}

function validateIngredientSections(
  value: unknown
): RecipeStructureValidationResult {
  if (!Array.isArray(value)) {
    return invalid("ingredientSections", "invalid-top-level")
  }
  if (value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe) {
    return invalid("ingredientSections", "too-many-sections")
  }

  let ingredientCount = 0
  for (const section of value) {
    if (!isRecord(section) || !hasExactKeys(section, ["label", "ingredients"])) {
      return invalid("ingredientSections", "invalid-section")
    }
    if (!isCanonicalLabel(section.label)) {
      return invalid("ingredientSections", "invalid-label")
    }
    if (!Array.isArray(section.ingredients)) {
      return invalid("ingredientSections", "invalid-section")
    }
    if (section.ingredients.length === 0) {
      return invalid("ingredientSections", "empty-section")
    }

    ingredientCount += section.ingredients.length
    if (ingredientCount > RECIPE_DATA_LIMITS.ingredientsPerRecipe) {
      return invalid("ingredientSections", "too-many-items")
    }

    for (const ingredient of section.ingredients) {
      if (
        !isRecord(ingredient) ||
        Object.keys(ingredient).some(
          (key) => !CANONICAL_INGREDIENT_KEYS.has(key)
        ) ||
        !normalizeIngredient(ingredient, "persist")
      ) {
        return invalid("ingredientSections", "invalid-ingredient")
      }
    }
  }

  return { valid: true }
}

function validateInstructionSections(
  value: unknown
): RecipeStructureValidationResult {
  if (!Array.isArray(value)) {
    return invalid("instructionSections", "invalid-top-level")
  }
  if (value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe) {
    return invalid("instructionSections", "too-many-sections")
  }

  let stepCount = 0
  for (const section of value) {
    if (!isRecord(section) || !hasExactKeys(section, ["label", "steps"])) {
      return invalid("instructionSections", "invalid-section")
    }
    if (!isCanonicalLabel(section.label)) {
      return invalid("instructionSections", "invalid-label")
    }
    if (!Array.isArray(section.steps)) {
      return invalid("instructionSections", "invalid-section")
    }
    if (section.steps.length === 0) {
      return invalid("instructionSections", "empty-section")
    }

    stepCount += section.steps.length
    if (stepCount > RECIPE_DATA_LIMITS.instructionsPerRecipe) {
      return invalid("instructionSections", "too-many-items")
    }

    for (const step of section.steps) {
      if (
        typeof step !== "string" ||
        step !== step.trim() ||
        step.length === 0 ||
        step.length > RECIPE_DATA_LIMITS.instructionLength
      ) {
        return invalid("instructionSections", "invalid-step")
      }
    }
  }

  return { valid: true }
}

function buildIngredientSectionsFromConsecutiveRuns(
  ingredients: Ingredient[]
): IngredientSection[] {
  const sections: IngredientSection[] = []
  for (const ingredient of ingredients) {
    const label = normalizeEditorLabel(ingredient.groupLabel)
    const current = sections[sections.length - 1]
    if (!current || current.label !== label) {
      sections.push({ label, ingredients: [] })
    }
    const { groupLabel: _groupLabel, ...canonical } = ingredient
    sections[sections.length - 1].ingredients.push(cloneIngredient(canonical))
  }
  return sections
}

function cloneIngredient(
  ingredient: CanonicalIngredient
): CanonicalIngredient {
  return {
    ...ingredient,
    ...(ingredient.alternatives
      ? { alternatives: [...ingredient.alternatives] }
      : {}),
  }
}

function normalizeEditorLabel(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function isCanonicalLabel(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= RECIPE_DATA_LIMITS.groupLabelLength)
  )
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[]
): boolean {
  const keys = Object.keys(value)
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function invalid(
  field: RecipeStructureField,
  code: RecipeStructureValidationIssue["code"]
): RecipeStructureValidationResult {
  return { valid: false, issue: { field, code } }
}

export function createEmptyInstructionGroup(): RecipeInstructionGroup {
  return { steps: [""] }
}

export function normalizeRecipeNotes(notes?: string[] | null): string[] {
  return (notes ?? []).map((note) => note.trim()).filter(Boolean)
}

export function normalizeRecipeInstructionGroups(
  groups?: RecipeInstructionGroup[] | null
): RecipeInstructionGroup[] {
  return (groups ?? [])
    .map((group) => ({
      label: group.label?.trim() || undefined,
      steps: group.steps.map((step) => step.trim()).filter(Boolean),
    }))
    .filter((group) => group.steps.length > 0)
}

export function ingredientSectionsToEditorIngredients(
  sections: IngredientSection[]
): Ingredient[] {
  return sections.flatMap((section) =>
    section.ingredients.map((ingredient) => ({
      ...cloneIngredient(ingredient),
      ...(section.label ? { groupLabel: section.label } : {}),
    }))
  )
}

export function editorIngredientsToIngredientSections(
  ingredients: Ingredient[]
): IngredientSection[] {
  return buildIngredientSectionsFromConsecutiveRuns(ingredients)
}

export function instructionSectionsToEditorGroups(
  sections: InstructionSection[]
): RecipeInstructionGroup[] {
  return sections.map((section) => ({
    ...(section.label ? { label: section.label } : {}),
    steps: [...section.steps],
  }))
}

export function editorGroupsToInstructionSections(
  groups: RecipeInstructionGroup[]
): InstructionSection[] {
  return normalizeRecipeInstructionGroups(groups).map((group) => ({
    label: group.label?.trim() || null,
    steps: [...group.steps],
  }))
}

export function normalizeInstructionGroupsForEditor(
  groups?: RecipeInstructionGroup[] | null
): RecipeInstructionGroup[] {
  const normalizedGroups = (groups ?? []).map((group) => ({
    label: group.label?.trim() || "",
    steps: (group.steps ?? []).map((step) => step ?? ""),
  }))

  if (normalizedGroups.length === 0) {
    return [createEmptyInstructionGroup()]
  }

  return normalizedGroups.map((group) => ({
    label: group.label,
    steps: group.steps.length > 0 ? group.steps : [""],
  }))
}

export function formatRecipeTime(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`
}
