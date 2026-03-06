import type { ParsedRecipe } from "@/lib/recipe-parser"
import type { Ingredient, Recipe, RecipeInsert } from "@/types/database"

export const DEFAULT_RECIPE_SERVINGS = 4

export const EMPTY_RECIPE_INGREDIENT: Ingredient = {
  item: "",
  amount: null,
  unit: "",
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
    ingredients: recipe.ingredients || [],
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
    ingredients: values.ingredients.filter((ingredient) => ingredient.item.trim()),
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

export function clampRecipeServings(value: number): number {
  return Math.min(100, Math.max(1, value))
}
