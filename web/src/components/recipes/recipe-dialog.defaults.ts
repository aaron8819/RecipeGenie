import type { ParsedRecipe } from "@/lib/recipe-parser"
import type { Ingredient, Recipe, RecipeInsert, RecipeInstructionGroup } from "@/types/database"
import {
  buildInstructionEditorGroups,
  createEmptyInstructionGroup,
  getRecipeNotes,
  normalizeInstructionGroupsForEditor,
  normalizeRecipeInstructionGroups,
  normalizeRecipeNotes,
} from "@/lib/recipe-structure"
import {
  WHOLE_COUNT_UNIT,
  normalizeWholeCountUnit,
} from "@/lib/ingredient-units"

export const DEFAULT_RECIPE_SERVINGS = 4

export const EMPTY_RECIPE_INGREDIENT: Ingredient = {
  item: "",
  amount: null,
  unit: "",
}

const UNIT_NORMALIZATION_MAP: Record<string, string> = {
  teaspoon: "tsp",
  teaspoons: "tsp",
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cups: "cup",
  ounce: "oz",
  ounces: "oz",
  pounds: "lb",
  lbs: "lb",
  pound: "lb",
  grams: "g",
  kilograms: "kg",
  milliliter: "ml",
  milliliters: "ml",
  liter: "l",
  liters: "l",
  pint: "pt",
  pints: "pt",
  quart: "qt",
  quarts: "qt",
  gallon: "gal",
  gallons: "gal",
  cans: "can",
  cloves: "clove",
  heads: "head",
  pieces: "piece",
  pcs: "piece",
  slices: "slice",
  pinches: "pinch",
  dashes: "dash",
  packages: "pkg",
  package: "pkg",
  pkgs: "pkg",
}

export interface RecipeDialogFormValues {
  name: string
  category: string
  servings: number
  prepTimeMinutes: number | null
  cookTimeMinutes: number | null
  totalTimeMinutes: number | null
  tags: string[]
  ingredients: Ingredient[]
  instructionGroups: RecipeInstructionGroup[]
  notes: string
  imageUrl: string | null
}

export function buildEditingRecipeDialogFormValues(
  recipe: Recipe
): RecipeDialogFormValues {
  return {
    name: recipe.name,
    category: recipe.category,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prep_time_minutes ?? null,
    cookTimeMinutes: recipe.cook_time_minutes ?? null,
    totalTimeMinutes: recipe.total_time_minutes ?? null,
    tags: recipe.tags || [],
    ingredients: normalizeRecipeIngredientsForEditing(recipe.ingredients || []),
    instructionGroups: normalizeInstructionGroupsForEditor(buildInstructionEditorGroups(
      recipe.instructions || [],
      recipe.instruction_groups
    )),
    notes: getRecipeNotes(recipe).join("\n"),
    imageUrl: recipe.image_url || null,
  }
}

export function buildNewRecipeDialogFormValues(
  categories: string[]
): RecipeDialogFormValues {
  return {
    name: "",
    category: categories[0] || "",
    servings: DEFAULT_RECIPE_SERVINGS,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    tags: [],
    ingredients: [{ ...EMPTY_RECIPE_INGREDIENT }],
    instructionGroups: [createEmptyInstructionGroup()],
    notes: "",
    imageUrl: null,
  }
}

export function applyParsedRecipeToFormValues(
  values: RecipeDialogFormValues,
  parsedRecipe: ParsedRecipe
): RecipeDialogFormValues {
  return {
    ...values,
    name: parsedRecipe.name || values.name,
    servings: parsedRecipe.servings || values.servings,
    prepTimeMinutes: parsedRecipe.metadata?.prepTimeMinutes ?? values.prepTimeMinutes,
    cookTimeMinutes: parsedRecipe.metadata?.cookTimeMinutes ?? values.cookTimeMinutes,
    totalTimeMinutes: parsedRecipe.metadata?.totalTimeMinutes ?? values.totalTimeMinutes,
    ingredients:
      parsedRecipe.ingredients.length > 0
        ? normalizeRecipeIngredientsForEditing(parsedRecipe.ingredients)
        : values.ingredients,
    instructionGroups:
      (parsedRecipe.instructionGroups && parsedRecipe.instructionGroups.length > 0) ||
      parsedRecipe.instructions.length > 0
        ? normalizeInstructionGroupsForEditor(buildInstructionEditorGroups(
            parsedRecipe.instructions,
            parsedRecipe.instructionGroups
          ))
        : values.instructionGroups,
    notes:
      parsedRecipe.notes && parsedRecipe.notes.length > 0
        ? parsedRecipe.notes.join("\n")
        : values.notes,
  }
}

export function buildRecipeSubmissionData(
  values: RecipeDialogFormValues
): Omit<RecipeInsert, "id" | "user_id"> {
  const instructionGroups = normalizeRecipeInstructionGroups(values.instructionGroups)
  const notes = normalizeRecipeNotes(
    values.notes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  )

  return {
    name: values.name.trim(),
    category: values.category,
    servings: values.servings,
    prep_time_minutes: values.prepTimeMinutes,
    cook_time_minutes: values.cookTimeMinutes,
    total_time_minutes: values.totalTimeMinutes,
    tags: values.tags || [],
    ingredients: normalizeRecipeIngredientsForSubmission(values.ingredients),
    instructions: instructionGroups.flatMap((group) => group.steps),
    instruction_groups: instructionGroups,
    notes,
    image_url: values.imageUrl,
  }
}

export function hasValidRecipeIngredients(ingredients: Ingredient[]): boolean {
  return ingredients.some((ingredient) => ingredient.item.trim())
}

export function isNewRecipeDialogDirty(values: {
  name: string
  defaultCategory: string
  category: string
  tags: string[]
  prepTimeMinutes: number | null
  cookTimeMinutes: number | null
  totalTimeMinutes: number | null
  ingredients: Ingredient[]
  instructionGroups: RecipeInstructionGroup[]
  notes: string
  imageReference: string | null
}): boolean {
  return (
    values.name.trim() !== "" ||
    values.category !== values.defaultCategory ||
    values.tags.length > 0 ||
    values.prepTimeMinutes !== null ||
    values.cookTimeMinutes !== null ||
    values.totalTimeMinutes !== null ||
    values.ingredients.some((ingredient) => ingredient.item.trim() !== "") ||
    normalizeRecipeInstructionGroups(values.instructionGroups).length > 0 ||
    values.notes.trim() !== "" ||
    values.imageReference !== null
  )
}

export function isEditingRecipeDialogDirty(
  initialValues: RecipeDialogFormValues,
  currentValues: RecipeDialogFormValues & { imageReference: string | null }
): boolean {
  return JSON.stringify({
    name: initialValues.name,
    category: initialValues.category,
    servings: initialValues.servings,
    prepTimeMinutes: initialValues.prepTimeMinutes,
    cookTimeMinutes: initialValues.cookTimeMinutes,
    totalTimeMinutes: initialValues.totalTimeMinutes,
    tags: initialValues.tags,
    ingredients: initialValues.ingredients,
    instructionGroups: normalizeRecipeInstructionGroups(initialValues.instructionGroups),
    notes: initialValues.notes,
    imageReference: initialValues.imageUrl,
  }) !== JSON.stringify({
    name: currentValues.name,
    category: currentValues.category,
    servings: currentValues.servings,
    prepTimeMinutes: currentValues.prepTimeMinutes,
    cookTimeMinutes: currentValues.cookTimeMinutes,
    totalTimeMinutes: currentValues.totalTimeMinutes,
    tags: currentValues.tags,
    ingredients: currentValues.ingredients,
    instructionGroups: normalizeRecipeInstructionGroups(currentValues.instructionGroups),
    notes: currentValues.notes,
    imageReference: currentValues.imageReference,
  })
}

export function clampRecipeServings(value: number): number {
  return Math.min(100, Math.max(1, value))
}

function normalizeIngredientWhitespace(value?: string | null): string {
  return (value || "").replace(/\s+/g, " ").trim()
}

export function normalizeIngredientUnit(unit?: string | null): string {
  const normalized = normalizeIngredientWhitespace(unit).toLowerCase()
  return normalizeWholeCountUnit(normalized) || UNIT_NORMALIZATION_MAP[normalized] || normalized
}

export function normalizeRecipeIngredient(ingredient: Ingredient): Ingredient {
  const item = normalizeIngredientWhitespace(ingredient.item)
  const normalizedUnit = normalizeIngredientUnit(ingredient.unit)
  const unit =
    normalizedUnit ||
    (item && ingredient.amount !== null && ingredient.amount > 0
      ? WHOLE_COUNT_UNIT
      : "")
  const groupLabel = normalizeIngredientWhitespace(ingredient.groupLabel)
  const modifier = normalizeIngredientWhitespace(ingredient.modifier)
  const alternatives = ingredient.alternatives
    ?.map((alternative) => normalizeIngredientWhitespace(alternative))
    .filter(Boolean)

  return {
    ...ingredient,
    item,
    unit,
    groupLabel: groupLabel || undefined,
    modifier: modifier || undefined,
    alternatives: alternatives && alternatives.length > 0 ? alternatives : undefined,
    originalText: normalizeIngredientWhitespace(ingredient.originalText) || undefined,
  }
}

export function normalizeRecipeIngredientsForEditing(
  ingredients: Ingredient[]
): Ingredient[] {
  return ingredients.map((ingredient) => normalizeRecipeIngredient(ingredient))
}

export function normalizeRecipeIngredientsForSubmission(
  ingredients: Ingredient[]
): Ingredient[] {
  return ingredients
    .map((ingredient) => normalizeRecipeIngredient(ingredient))
    .filter((ingredient) => ingredient.item)
}
