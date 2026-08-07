import type {
  Database,
  PlanTemplate,
  Recipe,
  RecipeHistory,
  ShoppingItem,
  WeeklyPlan,
} from "@/types/database"
import {
  normalizeShoppingItems,
  normalizeYieldMetadataForHydration,
} from "./recipe-data-validation"
import { validateRecipeStructure } from "./recipe-structure"
import type { IngredientSection, InstructionSection } from "@/types/database"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DatabaseRecipeRow = Database["public"]["Tables"]["recipes"]["Row"]
export type RecipeRow = Pick<
  DatabaseRecipeRow,
  | "category"
  | "cook_time_minutes"
  | "created_at"
  | "favorite"
  | "id"
  | "image_url"
  | "ingredient_sections"
  | "instruction_sections"
  | "name"
  | "notes"
  | "prep_time_minutes"
  | "recipe_uuid"
  | "servings"
  | "tags"
  | "total_time_minutes"
  | "updated_at"
  | "user_id"
  | "yield_metadata"
>

export function isRecipeUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function assertRecipeUuid(value: string, label = "Recipe ID"): string {
  if (!isRecipeUuid(value)) {
    throw new Error(`${label} must be a UUID`)
  }
  return value
}

export function createRecipeUuid(): string {
  return crypto.randomUUID()
}

/** The only database-row to application-recipe identity mapping seam. */
export function mapRecipeRow(row: RecipeRow): Recipe {
  const rawIngredientSections = row.ingredient_sections
  const rawInstructionSections = row.instruction_sections
  const structure = {
    ingredientSections: rawIngredientSections,
    instructionSections: rawInstructionSections,
  }
  const validation = validateRecipeStructure(structure)
  if (!validation.valid) {
    throw new Error(
      `Invalid canonical recipe structure: ${validation.issue.field}/${validation.issue.code}`
    )
  }
  return {
    category: row.category,
    cook_time_minutes: row.cook_time_minutes,
    created_at: row.created_at,
    favorite: row.favorite,
    image_url: row.image_url,
    name: row.name,
    notes: Array.isArray(row.notes) ? row.notes as string[] : [],
    prep_time_minutes: row.prep_time_minutes,
    servings: row.servings,
    tags: row.tags,
    total_time_minutes: row.total_time_minutes,
    updated_at: row.updated_at,
    user_id: row.user_id,
    ingredientSections: rawIngredientSections as IngredientSection[],
    instructionSections: rawInstructionSections as InstructionSection[],
    yield_metadata: normalizeYieldMetadataForHydration(row.yield_metadata),
    id: row.recipe_uuid,
    legacyId: row.id,
  } as Recipe
}

export function mapRecipeRows(rows: RecipeRow[] | null): Recipe[] {
  return (rows || []).map(mapRecipeRow)
}

export function recipeUuidWrite(recipeUuid: string) {
  const id = assertRecipeUuid(recipeUuid)
  return {
    // Stage 2C keeps one compatibility alias for migration 011. Migration 012
    // accepts the same matching pair while canonical identity stays recipe_uuid.
    id,
    recipe_uuid: id,
  }
}

type WeeklyPlanRow = Database["public"]["Tables"]["weekly_plans"]["Row"]
type PlanTemplateRow = Database["public"]["Tables"]["plan_templates"]["Row"]
type RecipeHistoryRow = Database["public"]["Tables"]["recipe_history"]["Row"]

export function mapWeeklyPlanRow(row: WeeklyPlanRow): WeeklyPlan {
  return {
    ...row,
    recipe_ids: row.recipe_uuids,
    day_assignments: row.day_assignment_recipe_uuids as Record<string, number> | null,
    made_recipe_ids: row.made_recipe_uuids,
  } as WeeklyPlan
}

export function mapPlanTemplateRow(row: PlanTemplateRow): PlanTemplate {
  return {
    ...row,
    recipe_ids: row.recipe_uuids,
    day_assignments: row.day_assignment_recipe_uuids as Record<string, number> | null,
  } as PlanTemplate
}

export function mapRecipeHistoryRow(row: RecipeHistoryRow): RecipeHistory {
  return {
    ...row,
    recipe_id: row.recipe_uuid,
    legacyRecipeId: row.recipe_id,
  } as RecipeHistory
}

export function mapShoppingItems<T extends ShoppingItem>(items: unknown): T[] {
  const normalized = normalizeShoppingItems(items, "hydrate") || []
  return normalized.map((item) => ({
    ...item,
    sources: item.sources?.map((source) => {
      const persisted = source as typeof source & { recipeUuid?: string }
      const legacyRecipeId = persisted.legacyRecipeId || persisted.recipeId
      const { recipeUuid, recipeId: _legacyRecipeId, ...display } = persisted
      return recipeUuid
        ? { ...display, recipeId: recipeUuid, legacyRecipeId }
        : { ...display, legacyRecipeId }
    }),
  })) as T[]
}
