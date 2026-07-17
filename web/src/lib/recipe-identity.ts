import type {
  Database,
  PlanTemplate,
  Recipe,
  RecipeHistory,
  ShoppingItem,
  ShoppingList,
  WeeklyPlan,
} from "@/types/database"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"]

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
  const { id: legacyId, recipe_uuid: id, ...recipe } = row
  return {
    ...recipe,
    id,
    legacyId,
  } as Recipe
}

export function mapRecipeRows(rows: RecipeRow[] | null): Recipe[] {
  return (rows || []).map(mapRecipeRow)
}

export function recipeUuidWrite(recipeUuid: string) {
  return {
    // Stage 2C sends only canonical identity. PostgreSQL derives the temporary
    // text primary-key mirror until Stage 3 promotes recipe_uuid physically.
    recipe_uuid: assertRecipeUuid(recipeUuid),
  }
}

type WeeklyPlanRow = Database["public"]["Tables"]["weekly_plans"]["Row"]
type PlanTemplateRow = Database["public"]["Tables"]["plan_templates"]["Row"]
type RecipeHistoryRow = Database["public"]["Tables"]["recipe_history"]["Row"]
type ShoppingListRow = Database["public"]["Tables"]["shopping_list"]["Row"]

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

export function mapShoppingListRow(row: ShoppingListRow): ShoppingList {
  return {
    ...row,
    items: mapShoppingItems(row.items as unknown as ShoppingItem[]),
    already_have: mapShoppingItems(row.already_have as unknown as ShoppingItem[]),
    excluded: mapShoppingItems(row.excluded as unknown as ShoppingItem[]),
    source_recipes: row.source_recipe_uuids,
  } as ShoppingList
}

export function mapShoppingItems<T extends ShoppingItem>(items: T[]): T[] {
  return (items || []).map((item) => ({
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
