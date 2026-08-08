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

export type RationalV1 = {
  numerator: string
  denominator: string
}

export type QuantitySourceV1 =
  | "authored"
  | "original-text"
  | "legacy-synthesized"

type QuantityBaseV1 = {
  version: 1
  authored: string
  source: QuantitySourceV1
  qualifier?: "about" | "approximately" | "around"
}

export type QuantityV1 =
  | (QuantityBaseV1 & {
      kind: "exact"
      value: RationalV1
      lexeme: string
    })
  | (QuantityBaseV1 & {
      kind: "range"
      start: RationalV1
      end: RationalV1
      startLexeme: string
      endLexeme: string
      separator: "-" | "–" | "—"
    })
  | (QuantityBaseV1 & {
      kind: "qualitative"
    })
  | (QuantityBaseV1 & {
      kind: "unparsed"
      reason?: string
    })

export type PackageV1 = {
  version: 1
  count: QuantityV1
  size: {
    value: RationalV1
    lexeme: string
    unit: string
    authoredUnit: string
  }
  type: string
  authoredType: string
}

export type YieldKindV1 = "servings" | "portions" | "items" | "other"

export type YieldMetadataV1 = {
  version: 1
  authoredText: string
  kind: YieldKindV1
  scalingBasis: RationalV1
  value?: RationalV1
  range?: {
    start: RationalV1
    end: RationalV1
    startLexeme: string
    endLexeme: string
    separator: "-" | "–" | "—"
  }
}

export type Ingredient = {
  item: string
  amount: number | string | null
  unit: string
  quantityV1?: QuantityV1
  authoredUnit?: string
  packageV1?: PackageV1
  shoppingCategory?: string
  groupLabel?: string
  modifier?: string
  alternatives?: string[]
  originalText?: string
}

export type CanonicalIngredient = Omit<Ingredient, "groupLabel">

export type IngredientSection = {
  label: string | null
  ingredients: CanonicalIngredient[]
}

export type InstructionSection = {
  label: string | null
  steps: string[]
}

export type RecipeStructure = {
  ingredientSections: IngredientSection[]
  instructionSections: InstructionSection[]
}

export type RecipeContent = RecipeStructure & {
  notes: string[]
}

export type RecipeInstructionGroup = {
  label?: string
  steps: string[]
}

export type ShoppingItem = {
  rowId?: string
  orderingKey?: string
  item: string
  amount: number | null
  unit: string
  exactQuantityV1?: QuantityV1
  exactPackageV1?: PackageV1
  exactAuthoredUnit?: string
  structuredSourceKey?: string
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
    exactQuantityV1?: QuantityV1
    exactPackageV1?: PackageV1
    exactAuthoredUnit?: string
    exactScaleV1?: RationalV1
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

export type ShoppingConfig = {
  category_overrides: Record<string, string>
  custom_categories: CustomShoppingCategory[]
  category_order: string[] | null
  excluded_keywords: string[]
  exclude_salt_variants: boolean
  exclude_black_pepper_variants: boolean
}

export type RecipeShareSnapshot = {
  name: string
  category: string
  servings: number
  tags: string[]
  ingredient_sections: IngredientSection[]
  instruction_sections: InstructionSection[]
  image_url: string | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  notes?: string[] | null
  yield_metadata?: YieldMetadataV1 | null
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
  | "ingredient_sections"
  | "instruction_sections"
  | "notes"
  | "recipe_uuid"
  | "prep_time_minutes"
  | "cook_time_minutes"
  | "total_time_minutes"
  | "yield_metadata"
> & {
  ingredientSections: IngredientSection[]
  instructionSections: InstructionSection[]
  notes?: string[] | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  yield_metadata?: YieldMetadataV1 | null
  /** Canonical application identity. */
  id: string
  /** Immutable compatibility alias, never used as application identity. */
  legacyId?: string
}

type RecipeInsertBase = Database["public"]["Tables"]["recipes"]["Insert"]
export type RecipeInsert = Omit<
  RecipeInsertBase,
  | "ingredient_sections"
  | "instruction_sections"
  | "notes"
  | "recipe_uuid"
  | "yield_metadata"
> & {
  ingredient_sections?: IngredientSection[]
  instruction_sections?: InstructionSection[]
  notes?: string[] | null
  yield_metadata?: YieldMetadataV1 | null
}

type RecipeUpdateBase = Database["public"]["Tables"]["recipes"]["Update"]
export type RecipeUpdate = Omit<
  RecipeUpdateBase,
  | "ingredient_sections"
  | "instruction_sections"
  | "notes"
  | "recipe_uuid"
  | "yield_metadata"
> & {
  ingredient_sections?: IngredientSection[]
  instruction_sections?: InstructionSection[]
  notes?: string[] | null
  yield_metadata?: YieldMetadataV1 | null
}

export type PantryItem = Database["public"]["Tables"]["pantry_items"]["Row"]

type UserConfigBase = Database["public"]["Tables"]["user_config"]["Row"]
export type UserConfig = Omit<
  UserConfigBase,
  "default_selection"
> & {
  default_selection: Record<string, number>
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

export type ShoppingList = {
  user_id: string
  items: ShoppingItem[]
  already_have: ShoppingItem[]
  excluded: ShoppingItem[]
  source_recipes: string[]
  scale: number
  total_servings: number
  custom_order: boolean
  generated_at?: string
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
