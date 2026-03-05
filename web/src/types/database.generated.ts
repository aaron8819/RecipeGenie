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
          ingredients: Json
          instructions: string[]
          image_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          name: string
          category: string
          servings?: number
          favorite?: boolean
          tags?: string[]
          ingredients?: Json
          instructions?: string[]
          image_url?: string | null
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
          ingredients?: Json
          instructions?: string[]
          image_url?: string | null
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
          user_id?: string
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
          default_selection: Json
          excluded_keywords: string[]
          history_exclusion_days: number
          week_start_day: number
          onboarding_completed_at: string | null
          category_overrides: Json
          custom_categories: Json
          category_order: string[] | null
          excluded_days: number[]
          preferred_days: number[] | null
          auto_assign_days: boolean
          enabled_planner_categories: string[] | null
        }
        Insert: {
          user_id?: string
          categories?: string[]
          default_selection?: Json
          excluded_keywords?: string[]
          history_exclusion_days?: number
          week_start_day?: number
          onboarding_completed_at?: string | null
          category_overrides?: Json
          custom_categories?: Json
          category_order?: string[] | null
          excluded_days?: number[]
          preferred_days?: number[] | null
          auto_assign_days?: boolean
          enabled_planner_categories?: string[] | null
        }
        Update: {
          user_id?: string
          categories?: string[]
          default_selection?: Json
          excluded_keywords?: string[]
          history_exclusion_days?: number
          week_start_day?: number
          onboarding_completed_at?: string | null
          category_overrides?: Json
          custom_categories?: Json
          category_order?: string[] | null
          excluded_days?: number[]
          preferred_days?: number[] | null
          auto_assign_days?: boolean
          enabled_planner_categories?: string[] | null
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
          user_id?: string
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
          day_assignments: Json | null
          scale: number
          generated_at: string
        }
        Insert: {
          user_id?: string
          week_date: string
          recipe_ids?: string[]
          made_recipe_ids?: string[]
          day_assignments?: Json | null
          scale?: number
          generated_at?: string
        }
        Update: {
          user_id?: string
          week_date?: string
          recipe_ids?: string[]
          made_recipe_ids?: string[]
          day_assignments?: Json | null
          scale?: number
          generated_at?: string
        }
      }
      shopping_list: {
        Row: {
          user_id: string
          items: Json
          already_have: Json
          excluded: Json
          source_recipes: string[]
          scale: number
          total_servings: number
          custom_order: boolean
          generated_at: string
        }
        Insert: {
          user_id?: string
          items?: Json
          already_have?: Json
          excluded?: Json
          source_recipes?: string[]
          scale?: number
          total_servings?: number
          custom_order?: boolean
          generated_at?: string
        }
        Update: {
          user_id?: string
          items?: Json
          already_have?: Json
          excluded?: Json
          source_recipes?: string[]
          scale?: number
          total_servings?: number
          custom_order?: boolean
          generated_at?: string
        }
      }
      plan_templates: {
        Row: {
          id: string
          user_id: string
          name: string
          recipe_ids: string[]
          day_assignments: Json | null
          category_selection: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          name: string
          recipe_ids?: string[]
          day_assignments?: Json | null
          category_selection?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          recipe_ids?: string[]
          day_assignments?: Json | null
          category_selection?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      recipe_shares: {
        Row: {
          id: string
          sender_user_id: string
          sender_email: string
          recipient_user_id: string
          recipient_email: string
          source_recipe_id: string
          source_recipe_snapshot: Json
          message: string | null
          status: "pending" | "accepted" | "declined" | "canceled"
          accepted_recipe_id: string | null
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          sender_user_id: string
          sender_email: string
          recipient_user_id: string
          recipient_email: string
          source_recipe_id: string
          source_recipe_snapshot: Json
          message?: string | null
          status?: "pending" | "accepted" | "declined" | "canceled"
          accepted_recipe_id?: string | null
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          sender_user_id?: string
          sender_email?: string
          recipient_user_id?: string
          recipient_email?: string
          source_recipe_id?: string
          source_recipe_snapshot?: Json
          message?: string | null
          status?: "pending" | "accepted" | "declined" | "canceled"
          accepted_recipe_id?: string | null
          created_at?: string
          responded_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_recipe_share: {
        Args: {
          p_share_id: string
        }
        Returns: string
      }
      delete_tag: {
        Args: {
          p_user_id: string
          p_tag: string
        }
        Returns: undefined
      }
      filter_recipes_by_tags: {
        Args: {
          p_user_id: string
          p_tags: string[]
        }
        Returns: Database["public"]["Tables"]["recipes"]["Row"][]
      }
      get_recipe_history_stats: {
        Args: {
          p_user_id: string
        }
        Returns: {
          recipe_id: string
          times_made: number
          last_made: string
        }[]
      }
      merge_tags: {
        Args: {
          p_user_id: string
          p_source_tag: string
          p_target_tag: string
        }
        Returns: undefined
      }
      rename_tag: {
        Args: {
          p_user_id: string
          p_old_tag: string
          p_new_tag: string
        }
        Returns: undefined
      }
      move_shopping_item_to_pantry: {
        Args: {
          p_item_name: string
          p_item_index: number
          p_pantry_qty: number | null
          p_pantry_unit: string | null
        }
        Returns: {
          removed_item: Json
          pantry_item: Json
          shopping_list_updated_at: string
          pantry_was_inserted: boolean
        }[]
      }
      toggle_weekly_recipe_made: {
        Args: {
          p_recipe_id: string
          p_week_date: string
          p_is_made_for_week: boolean
          p_date_made?: string | null
        }
        Returns: {
          action: string
          recipe_id: string
          week_date: string
          made_recipe_ids: string[]
          history_date_made: string | null
        }[]
      }
      toggle_shopping_item_checked: {
        Args: {
          p_item_name: string
        }
        Returns: {
          item_name: string
          checked: boolean
          updated_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}


