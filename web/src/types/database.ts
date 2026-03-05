// NOTE: This file is hand-written. Do not overwrite with Supabase type generation.
// Generated output lives in database.generated.ts.
import type {
  Database as GeneratedDatabase,
  Json as GeneratedJson,
} from "./database.generated"

export type Database = GeneratedDatabase
export type Json = GeneratedJson

export interface CustomShoppingCategory {
  id: string
  name: string
  order: number
}

export interface Ingredient {
  item: string
  amount: number | null
  unit: string
  shoppingCategory?: string
  modifier?: string
  alternatives?: string[]
  originalText?: string
}

export interface ShoppingItem {
  item: string
  amount: number | null
  unit: string
  categoryKey: string
  categoryOrder: number
  sources?: { recipeId?: string; recipeName: string }[]
  shoppingCategory?: string
  additionalAmounts?: { amount: number; unit: string }[]
  checked?: boolean
  excludedBy?: string
}

export interface RecipeShareSnapshot {
  name: string
  category: string
  servings: number
  tags: string[]
  ingredients: Ingredient[]
  instructions: string[]
  image_url: string | null
}

export interface RecipeHistoryStats {
  recipe_id: string
  times_made: number
  last_made: string
}

type RecipeBase = Database["public"]["Tables"]["recipes"]["Row"]
export type Recipe = Omit<RecipeBase, "ingredients"> & {
  ingredients: Ingredient[]
}

type RecipeInsertBase = Database["public"]["Tables"]["recipes"]["Insert"]
export type RecipeInsert = Omit<RecipeInsertBase, "ingredients"> & {
  ingredients?: Ingredient[]
}

type RecipeUpdateBase = Database["public"]["Tables"]["recipes"]["Update"]
export type RecipeUpdate = Omit<RecipeUpdateBase, "ingredients"> & {
  ingredients?: Ingredient[]
}

export type PantryItem = Database["public"]["Tables"]["pantry_items"]["Row"]

type UserConfigBase = Database["public"]["Tables"]["user_config"]["Row"]
export type UserConfig = Omit<
  UserConfigBase,
  "default_selection" | "category_overrides" | "custom_categories"
> & {
  default_selection: Record<string, number>
  category_overrides: Record<string, string>
  custom_categories: CustomShoppingCategory[]
}

export type RecipeHistory = Database["public"]["Tables"]["recipe_history"]["Row"]
export type RecipeHistoryStatsRow = RecipeHistoryStats

type WeeklyPlanBase = Database["public"]["Tables"]["weekly_plans"]["Row"]
export type WeeklyPlan = Omit<WeeklyPlanBase, "day_assignments"> & {
  day_assignments: Record<string, number> | null
}

type ShoppingListBase = Database["public"]["Tables"]["shopping_list"]["Row"]
export type ShoppingList = Omit<
  ShoppingListBase,
  "items" | "already_have" | "excluded"
> & {
  items: ShoppingItem[]
  already_have: ShoppingItem[]
  excluded: ShoppingItem[]
}

type RecipeShareBase = Database["public"]["Tables"]["recipe_shares"]["Row"]
export type RecipeShare = Omit<RecipeShareBase, "source_recipe_snapshot"> & {
  source_recipe_snapshot: RecipeShareSnapshot
}

type RecipeShareInsertBase =
  Database["public"]["Tables"]["recipe_shares"]["Insert"]
export type RecipeShareInsert = Omit<
  RecipeShareInsertBase,
  "source_recipe_snapshot"
> & {
  source_recipe_snapshot: RecipeShareSnapshot
}

type RecipeShareUpdateBase =
  Database["public"]["Tables"]["recipe_shares"]["Update"]
export type RecipeShareUpdate = Omit<
  RecipeShareUpdateBase,
  "source_recipe_snapshot"
> & {
  source_recipe_snapshot?: RecipeShareSnapshot
}

type PlanTemplateBase = Database["public"]["Tables"]["plan_templates"]["Row"]
export type PlanTemplate = Omit<
  PlanTemplateBase,
  "day_assignments" | "category_selection"
> & {
  day_assignments: Record<string, number> | null
  category_selection: Record<string, number> | null
}
