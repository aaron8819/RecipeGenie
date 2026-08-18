import {
  hasIngredientAmount,
  type ParsedRecipe,
} from "@/lib/recipe-parser"
import type {
  Ingredient,
  IngredientSection,
  Recipe,
  RecipeInsert,
  RecipeInstructionGroup,
} from "@/types/database"
import {
  createEmptyInstructionGroup,
  editorGroupsToInstructionSections,
  instructionSectionsToEditorGroups,
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

export const EMPTY_RECIPE_INGREDIENT_SECTION: IngredientSection = {
  label: null,
  ingredients: [{ ...EMPTY_RECIPE_INGREDIENT }],
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
  ingredientSections: IngredientSection[]
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
    ingredientSections: normalizeIngredientSectionsForEditing(
      recipe.ingredientSections
    ),
    instructionGroups: normalizeInstructionGroupsForEditor(
      instructionSectionsToEditorGroups(recipe.instructionSections)
    ),
    notes: normalizeRecipeNotes(recipe.notes).join("\n"),
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
    ingredientSections: [cloneEmptyIngredientSection()],
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
    ingredientSections:
      parsedRecipe.ingredientSections.length > 0
        ? normalizeIngredientSectionsForEditing(parsedRecipe.ingredientSections)
        : values.ingredientSections,
    instructionGroups:
      parsedRecipe.instructionSections.length > 0
        ? normalizeInstructionGroupsForEditor(
            instructionSectionsToEditorGroups(parsedRecipe.instructionSections)
          )
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
    ingredient_sections: normalizeIngredientSectionsForSubmission(
      values.ingredientSections
    ),
    instruction_sections: editorGroupsToInstructionSections(instructionGroups),
    notes,
    image_url: values.imageUrl,
  }
}

export function hasValidRecipeIngredients(
  ingredientSections: IngredientSection[]
): boolean {
  return ingredientSections.some((section) =>
    section.ingredients.some((ingredient) => ingredient.item.trim())
  )
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
  ingredientSections: IngredientSection[]
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
    values.ingredientSections.some(
      (section) =>
        section.label?.trim() ||
        section.ingredients.some((ingredient) => ingredient.item.trim() !== "")
    ) ||
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
    ingredientSections: initialValues.ingredientSections,
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
    ingredientSections: currentValues.ingredientSections,
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

export function normalizeIngredientSectionsForEditing(
  sections: IngredientSection[]
): IngredientSection[] {
  if (sections.length === 0) {
    return [cloneEmptyIngredientSection()]
  }

  return sections.map((section) => ({
    label: section.label,
    ingredients: normalizeRecipeIngredientsForEditing(section.ingredients),
  }))
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

export function updateRecipeIngredientAlternatives(
  current: Ingredient,
  alternatives: string[]
): Ingredient {
  return {
    ...current,
    alternatives: alternatives.length > 0 ? [...alternatives] : undefined,
    originalText: undefined,
  }
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

export function normalizeIngredientSectionsForSubmission(
  sections: IngredientSection[]
): IngredientSection[] {
  return sections
    .map((section) => ({
      label: section.label?.trim() || null,
      ingredients: normalizeRecipeIngredientsForSubmission(
        section.ingredients
      ).map(({ groupLabel: _groupLabel, ...ingredient }) => ingredient),
    }))
    .filter((section) => section.ingredients.length > 0)
}

function cloneEmptyIngredientSection(
  label: string | null = null
): IngredientSection {
  return {
    label,
    ingredients: [{ ...EMPTY_RECIPE_INGREDIENT }],
  }
}
