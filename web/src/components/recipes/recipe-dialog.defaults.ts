import type { ParsedRecipe } from "@/lib/recipe-parser"
import type { Ingredient, Recipe, RecipeInsert } from "@/types/database"

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
  tags: string[]
  ingredients: Ingredient[]
  instructions: string
  imageUrl: string | null
}

export function buildEditingRecipeDialogFormValues(
  recipe: Recipe
): RecipeDialogFormValues {
  return {
    name: recipe.name,
    category: recipe.category,
    servings: recipe.servings,
    tags: recipe.tags || [],
    ingredients: normalizeRecipeIngredientsForEditing(recipe.ingredients || []),
    instructions: (recipe.instructions || []).join("\n"),
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
    tags: [],
    ingredients: [{ ...EMPTY_RECIPE_INGREDIENT }],
    instructions: "",
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
    ingredients:
      parsedRecipe.ingredients.length > 0
        ? parsedRecipe.ingredients
        : values.ingredients,
    instructions:
      parsedRecipe.instructions.length > 0
        ? parsedRecipe.instructions.join("\n")
        : values.instructions,
  }
}

export function buildRecipeSubmissionData(
  values: RecipeDialogFormValues
): Omit<RecipeInsert, "id" | "user_id"> {
  return {
    name: values.name.trim(),
    category: values.category,
    servings: values.servings,
    tags: values.tags || [],
    ingredients: normalizeRecipeIngredientsForSubmission(values.ingredients),
    instructions: values.instructions
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line),
    image_url: values.imageUrl,
  }
}

export function hasValidRecipeIngredients(ingredients: Ingredient[]): boolean {
  return ingredients.some((ingredient) => ingredient.item.trim())
}

export function isNewRecipeDialogDirty(values: {
  name: string
  ingredients: Ingredient[]
  instructions: string
}): boolean {
  return (
    values.name.trim() !== "" ||
    values.ingredients.some((ingredient) => ingredient.item.trim() !== "") ||
    values.instructions.trim() !== ""
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
    tags: initialValues.tags,
    ingredients: initialValues.ingredients,
    instructions: initialValues.instructions,
    imageReference: initialValues.imageUrl,
  }) !== JSON.stringify({
    name: currentValues.name,
    category: currentValues.category,
    servings: currentValues.servings,
    tags: currentValues.tags,
    ingredients: currentValues.ingredients,
    instructions: currentValues.instructions,
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
  return UNIT_NORMALIZATION_MAP[normalized] || normalized
}

export function normalizeRecipeIngredient(ingredient: Ingredient): Ingredient {
  const item = normalizeIngredientWhitespace(ingredient.item)
  const unit = normalizeIngredientUnit(ingredient.unit)
  const modifier = normalizeIngredientWhitespace(ingredient.modifier)
  const alternatives = ingredient.alternatives
    ?.map((alternative) => normalizeIngredientWhitespace(alternative))
    .filter(Boolean)

  return {
    ...ingredient,
    item,
    unit,
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
