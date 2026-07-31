import {
  hasIngredientAmount,
  type ParsedRecipe,
} from "@/lib/recipe-parser"
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
import {
  getAuthoredYieldText,
  isValidQuantityV1,
  normalizePackageV1,
  parseIngredientQuantityPrefix,
  parseQuantityV1,
  parseYieldMetadata,
  quantityToLegacyAmount,
  resolveIngredientQuantity,
} from "@/lib/recipe-quantity"
import {
  normalizeIngredient,
  normalizeIngredients,
  requireIngredientsForPersistence,
} from "@/lib/recipe-data-validation"

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
  yieldText?: string
  prepTimeMinutes: number | null
  cookTimeMinutes: number | null
  totalTimeMinutes: number | null
  tags: string[]
  ingredients: Ingredient[]
  instructionGroups: RecipeInstructionGroup[]
  notes: string
  imageUrl: string | null
}

interface ApplyParsedRecipeOptions {
  applyCategory?: boolean
  categories?: readonly string[]
}

export function buildEditingRecipeDialogFormValues(
  recipe: Recipe
): RecipeDialogFormValues {
  return {
    name: recipe.name,
    category: recipe.category,
    servings: recipe.servings,
    yieldText: getAuthoredYieldText(recipe.yield_metadata, recipe.servings),
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
    yieldText: `${DEFAULT_RECIPE_SERVINGS} servings`,
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
  parsedRecipe: ParsedRecipe,
  options: ApplyParsedRecipeOptions = {}
): RecipeDialogFormValues {
  const parsedCategory = options.applyCategory && parsedRecipe.category
    ? options.categories?.find(
        (category) =>
          category.trim().toLowerCase() === parsedRecipe.category?.trim().toLowerCase()
      )
    : undefined

  return {
    ...values,
    name: parsedRecipe.name || values.name,
    category: parsedCategory || values.category,
    servings: parsedRecipe.servings || values.servings,
    yieldText:
      parsedRecipe.yieldMetadata?.authoredText ||
      parsedRecipe.metadata?.servingsText ||
      values.yieldText || `${values.servings} servings`,
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
    yield_metadata:
      parseYieldMetadata(
        values.yieldText || `${values.servings} servings`,
        values.servings
      ) ||
      parseYieldMetadata(`${values.servings} servings`, values.servings),
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
  yieldText?: string
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
    (values.yieldText || `${DEFAULT_RECIPE_SERVINGS} servings`).trim() !==
      `${DEFAULT_RECIPE_SERVINGS} servings` ||
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
    yieldText:
      initialValues.yieldText ||
      `${initialValues.servings} servings`,
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
    yieldText:
      currentValues.yieldText ||
      `${currentValues.servings} servings`,
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

export function normalizeRecipeIngredient(
  ingredient: Ingredient,
  preserveAuthoredAmount = false
): Ingredient {
  const safeIngredient =
    normalizeIngredient(ingredient, "hydrate") || EMPTY_RECIPE_INGREDIENT
  const item = normalizeIngredientWhitespace(safeIngredient.item)
  const normalizedUnit = normalizeIngredientUnit(safeIngredient.unit)
  const unit =
    normalizedUnit ||
    (item && hasIngredientAmount(safeIngredient.amount)
      ? WHOLE_COUNT_UNIT
      : "")
  const groupLabel = normalizeIngredientWhitespace(safeIngredient.groupLabel)
  const modifier = normalizeIngredientWhitespace(safeIngredient.modifier)
  const alternatives = safeIngredient.alternatives
    ?.map((alternative) => normalizeIngredientWhitespace(alternative))
    .filter(Boolean)

  const manuallyAuthoredQuantity =
    typeof safeIngredient.amount === "string"
      ? parseQuantityV1(safeIngredient.amount)
      : null
  const resolved = resolveIngredientQuantity(safeIngredient)
  const structuredQuantity = isValidQuantityV1(safeIngredient.quantityV1)
    ? safeIngredient.quantityV1
    : null
  const quantityV1 =
    structuredQuantity ??
    (manuallyAuthoredQuantity &&
    manuallyAuthoredQuantity.kind !== "unparsed"
      ? manuallyAuthoredQuantity
      : resolved.quantity ?? undefined)

  return {
    ...safeIngredient,
    item,
    unit,
    amount:
      quantityV1 &&
      (quantityV1.kind === "exact" || quantityV1.kind === "range")
        ? preserveAuthoredAmount
          ? quantityV1.authored
          : quantityToLegacyAmount(quantityV1)
        : safeIngredient.amount,
    quantityV1,
    authoredUnit:
      normalizeIngredientWhitespace(safeIngredient.authoredUnit) ||
      normalizeIngredientWhitespace(safeIngredient.unit) ||
      undefined,
    packageV1: safeIngredient.packageV1 ?? resolved.packageV1,
    groupLabel: groupLabel || undefined,
    modifier: modifier || undefined,
    alternatives: alternatives && alternatives.length > 0 ? alternatives : undefined,
    originalText:
      normalizeIngredientWhitespace(safeIngredient.originalText) || undefined,
  }
}

export function normalizeRecipeIngredientsForEditing(
  ingredients: Ingredient[]
): Ingredient[] {
  return (normalizeIngredients(ingredients, "hydrate") || [])
    .map((ingredient) => normalizeRecipeIngredient(ingredient, true))
}

export function updateRecipeIngredientField(
  current: Ingredient,
  field: keyof Ingredient,
  value: string | number | null
): Ingredient {
  const ingredient: Ingredient = { ...current, [field]: value }
  if (["amount", "unit", "item", "modifier"].includes(field)) {
    ingredient.originalText = undefined
  }

  if (field === "amount") {
    const quantity =
      value == null ? null : parseQuantityV1(String(value), "authored")
    ingredient.quantityV1 =
      quantity && quantity.kind !== "unparsed" ? quantity : undefined
    if (ingredient.packageV1 && ingredient.quantityV1) {
      ingredient.packageV1 = normalizePackageV1({
        ...ingredient.packageV1,
        count: ingredient.quantityV1,
      }) ?? undefined
    } else if (ingredient.packageV1) {
      const authoredType = ingredient.packageV1.authoredType
      ingredient.unit = authoredType
      ingredient.authoredUnit = authoredType
      ingredient.packageV1 = undefined
    }
  }

  if (field === "unit") {
    const authoredUnit = String(value || "").replace(/\s+/g, " ").trim()
    ingredient.unit = authoredUnit
    ingredient.authoredUnit = authoredUnit || undefined
    const quantity = isValidQuantityV1(ingredient.quantityV1)
      ? ingredient.quantityV1
      : null
    const parsed =
      authoredUnit && quantity
        ? parseIngredientQuantityPrefix(
            `${quantity.authored} ${authoredUnit} __ingredient__`,
            "authored"
          )
        : null
    ingredient.packageV1 =
      parsed?.rest === "__ingredient__" && parsed.packageV1
        ? parsed.packageV1
        : undefined
  }

  return ingredient
}

export function normalizeRecipeIngredientsForSubmission(
  ingredients: Ingredient[]
): Ingredient[] {
  const populatedIngredients = ingredients.filter(
    (ingredient) =>
      typeof ingredient.item === "string" && ingredient.item.trim().length > 0
  )
  return requireIngredientsForPersistence(populatedIngredients)
    .map((ingredient) => normalizeRecipeIngredient(ingredient))
}
