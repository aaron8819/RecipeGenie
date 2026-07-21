// NOTE: This file is hand-written. Do not overwrite with Supabase type generation.
// Generated output lives in database.generated.ts.
import type {
  Database as GeneratedDatabase,
  Json as GeneratedJson,
} from "./database.generated"

export type Database = GeneratedDatabase
export type Json = GeneratedJson

export type CustomShoppingCategory = {
  id: string
  name: string
  order: number
}

export type Ingredient = {
  item: string
  amount: number | null
  unit: string
  shoppingCategory?: string
  groupLabel?: string
  modifier?: string
  alternatives?: string[]
  originalText?: string
}

export type RecipeInstructionGroup = {
  label?: string
  steps: string[]
}

export type ShoppingItem = {
  rowId?: string
  item: string
  amount: number | null
  unit: string
  categoryKey: string
  categoryOrder: number
  sources?: {
    recipeId?: string
    legacyRecipeId?: string
    recipeName: string
    originalItem?: string
    originalAmount?: number | null
    originalUnit?: string | null
    originalText?: string
    prepIntent?: string
    preparationModifiers?: string[]
    optional?: boolean
  }[]
  shoppingCategory?: string
  additionalAmounts?: { amount: number; unit: string }[]
  checked?: boolean
  excludedBy?: string
  contributionKey?: string
  derivedQuantity?: {
    amount: number | null
    unit: string
    additionalAmounts?: { amount: number; unit: string }[]
  }
  legacyRecipeProvenance?: boolean
}

export type ShoppingItemOrderPreferences = Record<string, string[]>

export type RecipeShareSnapshot = {
  name: string
  category: string
  servings: number
  tags: string[]
  ingredients: Ingredient[]
  instructions: string[]
  image_url: string | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  notes?: string[] | null
  instruction_groups?: RecipeInstructionGroup[] | null
}

export interface RecipeHistoryStats {
  recipe_id: string
  times_made: number
  last_made: string
}

type RecipeBase = Database["public"]["Tables"]["recipes"]["Row"]
export type Recipe = Omit<
  RecipeBase,
  | "id"
  | "ingredients"
  | "notes"
  | "instruction_groups"
  | "recipe_uuid"
  | "prep_time_minutes"
  | "cook_time_minutes"
  | "total_time_minutes"
> & {
  ingredients: Ingredient[]
  notes?: string[] | null
  instruction_groups?: RecipeInstructionGroup[] | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  /** Canonical application identity. */
  id: string
  /** Immutable compatibility alias, never used as application identity. */
  legacyId?: string
}

type RecipeInsertBase = Database["public"]["Tables"]["recipes"]["Insert"]
export type RecipeInsert = Omit<
  RecipeInsertBase,
  | "ingredients"
  | "notes"
  | "instruction_groups"
  | "recipe_uuid"
> & {
  ingredients?: Ingredient[]
  notes?: string[] | null
  instruction_groups?: RecipeInstructionGroup[] | null
}

type RecipeUpdateBase = Database["public"]["Tables"]["recipes"]["Update"]
export type RecipeUpdate = Omit<
  RecipeUpdateBase,
  | "ingredients"
  | "notes"
  | "instruction_groups"
  | "recipe_uuid"
> & {
  ingredients?: Ingredient[]
  notes?: string[] | null
  instruction_groups?: RecipeInstructionGroup[] | null
}

export type PantryItem = Database["public"]["Tables"]["pantry_items"]["Row"]

type UserConfigBase = Database["public"]["Tables"]["user_config"]["Row"]
export type UserConfig = Omit<
  UserConfigBase,
  "default_selection" | "category_overrides" | "custom_categories" | "shopping_item_order"
> & {
  default_selection: Record<string, number>
  category_overrides: Record<string, string>
  custom_categories: CustomShoppingCategory[]
  shopping_item_order: ShoppingItemOrderPreferences
}

type RecipeHistoryBase = Database["public"]["Tables"]["recipe_history"]["Row"]
export type RecipeHistory = Omit<RecipeHistoryBase, "recipe_uuid">
export type RecipeHistoryStatsRow = RecipeHistoryStats

type WeeklyPlanBase = Database["public"]["Tables"]["weekly_plans"]["Row"]
export type WeeklyPlan = Omit<
  WeeklyPlanBase,
  | "day_assignments"
  | "recipe_uuids"
  | "day_assignment_recipe_uuids"
  | "made_recipe_uuids"
> & {
  day_assignments: Record<string, number> | null
}

type ShoppingListBase = Database["public"]["Tables"]["shopping_list"]["Row"]
export type ShoppingList = Omit<
  ShoppingListBase,
  | "items"
  | "already_have"
  | "excluded"
  | "contribution_revision"
  | "contribution_overrides"
  | "legacy_items_preserved"
  | "source_recipe_uuids"
> & {
  items: ShoppingItem[]
  already_have: ShoppingItem[]
  excluded: ShoppingItem[]
  contribution_revision?: number
  contribution_overrides?: Json
  legacy_items_preserved?: boolean
  /** Database-maintained compatibility mirror; application use begins in Stage 2B. */
  readonly source_recipe_uuids?: string[]
}

type RecipeShareBase = Database["public"]["Tables"]["recipe_shares"]["Row"]
export type RecipeShare = Omit<
  RecipeShareBase,
  "source_recipe_snapshot" | "source_recipe_uuid" | "accepted_recipe_uuid"
> & {
  source_recipe_snapshot: RecipeShareSnapshot
}

type RecipeShareInsertBase =
  Database["public"]["Tables"]["recipe_shares"]["Insert"]
export type RecipeShareInsert = Omit<
  RecipeShareInsertBase,
  "source_recipe_snapshot" | "source_recipe_uuid" | "accepted_recipe_uuid"
> & {
  source_recipe_snapshot: RecipeShareSnapshot
}

type RecipeShareUpdateBase =
  Database["public"]["Tables"]["recipe_shares"]["Update"]
export type RecipeShareUpdate = Omit<
  RecipeShareUpdateBase,
  "source_recipe_snapshot" | "source_recipe_uuid" | "accepted_recipe_uuid"
> & {
  source_recipe_snapshot?: RecipeShareSnapshot
}

type PlanTemplateBase = Database["public"]["Tables"]["plan_templates"]["Row"]
export type PlanTemplate = Omit<
  PlanTemplateBase,
  | "day_assignments"
  | "category_selection"
  | "recipe_uuids"
  | "day_assignment_recipe_uuids"
> & {
  day_assignments: Record<string, number> | null
  category_selection: Record<string, number> | null
}
