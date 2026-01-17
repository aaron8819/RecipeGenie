export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      recipes: {
        Row: {
          id: string
          user_id: string
          name: string
          category: string
          servings: number
          favorite: boolean
          tags: string[]
          ingredients: Ingredient[]
          instructions: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string  // Optional - generated from name if not provided
          user_id?: string // Optional - will be set by RLS/trigger
          name: string
          category: string
          servings?: number
          favorite?: boolean
          tags?: string[]
          ingredients?: Ingredient[]
          instructions?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          category?: string
          servings?: number
          favorite?: boolean
          tags?: string[]
          ingredients?: Ingredient[]
          instructions?: string[]
          created_at?: string
          updated_at?: string
        }
      }
      pantry_items: {
        Row: {
          user_id: string
          item: string
          created_at: string
        }
        Insert: {
          user_id?: string // Optional - will be set by RLS/trigger
          item: string
          created_at?: string
        }
        Update: {
          user_id?: string
          item?: string
          created_at?: string
        }
      }
      user_config: {
        Row: {
          user_id: string
          categories: string[]
          default_selection: Record<string, number>
          excluded_keywords: string[]
          history_exclusion_days: number
          week_start_day: number
          category_overrides: Record<string, string>
        }
        Insert: {
          user_id?: string // Optional - will be set by RLS/trigger
          categories?: string[]
          default_selection?: Record<string, number>
          excluded_keywords?: string[]
          history_exclusion_days?: number
          week_start_day?: number
          category_overrides?: Record<string, string>
        }
        Update: {
          user_id?: string
          categories?: string[]
          default_selection?: Record<string, number>
          excluded_keywords?: string[]
          history_exclusion_days?: number
          week_start_day?: number
          category_overrides?: Record<string, string>
        }
      }
      recipe_history: {
        Row: {
          id: number
          user_id: string
          recipe_id: string
          date_made: string
        }
        Insert: {
          id?: number
          user_id?: string // Optional - will be set by RLS/trigger
          recipe_id: string
          date_made?: string
        }
        Update: {
          id?: number
          user_id?: string
          recipe_id?: string
          date_made?: string
        }
      }
      weekly_plans: {
        Row: {
          user_id: string
          week_date: string
          recipe_ids: string[]
          made_recipe_ids: string[]
          scale: number
          generated_at: string
        }
        Insert: {
          user_id?: string // Optional - will be set by RLS/trigger
          week_date: string
          recipe_ids?: string[]
          made_recipe_ids?: string[]
          scale?: number
          generated_at?: string
        }
        Update: {
          user_id?: string
          week_date?: string
          recipe_ids?: string[]
          made_recipe_ids?: string[]
          scale?: number
          generated_at?: string
        }
      }
      shopping_list: {
        Row: {
          user_id: string
          items: ShoppingItem[]
          already_have: ShoppingItem[]
          excluded: ShoppingItem[]
          source_recipes: string[]
          scale: number
          total_servings: number
          custom_order: boolean
          generated_at: string
        }
        Insert: {
          user_id?: string // Optional - will be set by RLS/trigger
          items?: ShoppingItem[]
          already_have?: ShoppingItem[]
          excluded?: ShoppingItem[]
          source_recipes?: string[]
          scale?: number
          total_servings?: number
          custom_order?: boolean
          generated_at?: string
        }
        Update: {
          user_id?: string
          items?: ShoppingItem[]
          already_have?: ShoppingItem[]
          excluded?: ShoppingItem[]
          source_recipes?: string[]
          scale?: number
          total_servings?: number
          custom_order?: boolean
          generated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Application types
export interface Ingredient {
  item: string
  amount: number | null
  unit: string
  shoppingCategory?: string
}

export interface ShoppingItem {
  item: string
  amount: number | null
  unit: string
  categoryKey: string
  categoryOrder: number
  sources?: { recipeName: string }[]
  shoppingCategory?: string
  // Additional amounts when units can't be converted (e.g., "1/3 cup + 4 oz")
  additionalAmounts?: { amount: number; unit: string }[]
}

export type Recipe = Database["public"]["Tables"]["recipes"]["Row"]
export type RecipeInsert = Database["public"]["Tables"]["recipes"]["Insert"]
export type RecipeUpdate = Database["public"]["Tables"]["recipes"]["Update"]

export type PantryItem = Database["public"]["Tables"]["pantry_items"]["Row"]
export type UserConfig = Database["public"]["Tables"]["user_config"]["Row"]
export type RecipeHistory = Database["public"]["Tables"]["recipe_history"]["Row"]
export type WeeklyPlan = Database["public"]["Tables"]["weekly_plans"]["Row"]
export type ShoppingList = Database["public"]["Tables"]["shopping_list"]["Row"]
