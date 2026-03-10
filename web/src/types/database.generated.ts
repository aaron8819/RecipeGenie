export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      pantry_items: {
        Row: {
          created_at: string | null
          id: string
          item: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_templates: {
        Row: {
          category_selection: Json | null
          created_at: string | null
          day_assignments: Json | null
          id: string
          name: string
          recipe_ids: string[]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category_selection?: Json | null
          created_at?: string | null
          day_assignments?: Json | null
          id?: string
          name: string
          recipe_ids?: string[]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category_selection?: Json | null
          created_at?: string | null
          day_assignments?: Json | null
          id?: string
          name?: string
          recipe_ids?: string[]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recipe_history: {
        Row: {
          date_made: string
          id: number
          recipe_id: string
          user_id: string
        }
        Insert: {
          date_made?: string
          id?: never
          recipe_id: string
          user_id: string
        }
        Update: {
          date_made?: string
          id?: never
          recipe_id?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_shares: {
        Row: {
          accepted_recipe_id: string | null
          created_at: string
          id: string
          message: string | null
          recipient_email: string
          recipient_user_id: string
          responded_at: string | null
          sender_email: string
          sender_user_id: string
          source_recipe_id: string
          source_recipe_snapshot: Json
          status: string
        }
        Insert: {
          accepted_recipe_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          recipient_email: string
          recipient_user_id: string
          responded_at?: string | null
          sender_email: string
          sender_user_id: string
          source_recipe_id: string
          source_recipe_snapshot: Json
          status?: string
        }
        Update: {
          accepted_recipe_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          recipient_email?: string
          recipient_user_id?: string
          responded_at?: string | null
          sender_email?: string
          sender_user_id?: string
          source_recipe_id?: string
          source_recipe_snapshot?: Json
          status?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          category: string
          cook_time_minutes: number | null
          created_at: string | null
          favorite: boolean | null
          id: string
          image_url: string | null
          ingredients: Json
          instruction_groups: Json | null
          instructions: string[]
          name: string
          notes: Json
          prep_time_minutes: number | null
          servings: number
          tags: string[] | null
          total_time_minutes: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category: string
          cook_time_minutes?: number | null
          created_at?: string | null
          favorite?: boolean | null
          id: string
          image_url?: string | null
          ingredients?: Json
          instruction_groups?: Json | null
          instructions?: string[]
          name: string
          notes?: Json
          prep_time_minutes?: number | null
          servings?: number
          tags?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string
          cook_time_minutes?: number | null
          created_at?: string | null
          favorite?: boolean | null
          id?: string
          image_url?: string | null
          ingredients?: Json
          instruction_groups?: Json | null
          instructions?: string[]
          name?: string
          notes?: Json
          prep_time_minutes?: number | null
          servings?: number
          tags?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopping_list: {
        Row: {
          already_have: Json | null
          custom_order: boolean | null
          excluded: Json | null
          generated_at: string | null
          items: Json | null
          scale: number | null
          source_recipes: string[] | null
          total_servings: number | null
          user_id: string
        }
        Insert: {
          already_have?: Json | null
          custom_order?: boolean | null
          excluded?: Json | null
          generated_at?: string | null
          items?: Json | null
          scale?: number | null
          source_recipes?: string[] | null
          total_servings?: number | null
          user_id: string
        }
        Update: {
          already_have?: Json | null
          custom_order?: boolean | null
          excluded?: Json | null
          generated_at?: string | null
          items?: Json | null
          scale?: number | null
          source_recipes?: string[] | null
          total_servings?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_config: {
        Row: {
          auto_assign_days: boolean | null
          categories: string[] | null
          category_order: Json | null
          category_overrides: Json | null
          custom_categories: Json | null
          default_selection: Json | null
          enabled_planner_categories: string[] | null
          excluded_days: number[] | null
          excluded_keywords: string[] | null
          history_exclusion_days: number | null
          onboarding_completed_at: string | null
          preferred_days: number[] | null
          user_id: string
          week_start_day: number | null
        }
        Insert: {
          auto_assign_days?: boolean | null
          categories?: string[] | null
          category_order?: Json | null
          category_overrides?: Json | null
          custom_categories?: Json | null
          default_selection?: Json | null
          enabled_planner_categories?: string[] | null
          excluded_days?: number[] | null
          excluded_keywords?: string[] | null
          history_exclusion_days?: number | null
          onboarding_completed_at?: string | null
          preferred_days?: number[] | null
          user_id: string
          week_start_day?: number | null
        }
        Update: {
          auto_assign_days?: boolean | null
          categories?: string[] | null
          category_order?: Json | null
          category_overrides?: Json | null
          custom_categories?: Json | null
          default_selection?: Json | null
          enabled_planner_categories?: string[] | null
          excluded_days?: number[] | null
          excluded_keywords?: string[] | null
          history_exclusion_days?: number | null
          onboarding_completed_at?: string | null
          preferred_days?: number[] | null
          user_id?: string
          week_start_day?: number | null
        }
        Relationships: []
      }
      weekly_plans: {
        Row: {
          day_assignments: Json | null
          generated_at: string | null
          made_recipe_ids: string[] | null
          recipe_ids: string[]
          scale: number | null
          user_id: string
          week_date: string
        }
        Insert: {
          day_assignments?: Json | null
          generated_at?: string | null
          made_recipe_ids?: string[] | null
          recipe_ids?: string[]
          scale?: number | null
          user_id: string
          week_date: string
        }
        Update: {
          day_assignments?: Json | null
          generated_at?: string | null
          made_recipe_ids?: string[] | null
          recipe_ids?: string[]
          scale?: number | null
          user_id?: string
          week_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_recipe_share: { Args: { p_share_id: string }; Returns: string }
      delete_tag: {
        Args: { p_tag: string; p_user_id: string }
        Returns: undefined
      }
      filter_recipes_by_tags: {
        Args: { p_tags: string[]; p_user_id: string }
        Returns: {
          category: string
          cook_time_minutes: number | null
          created_at: string | null
          favorite: boolean | null
          id: string
          image_url: string | null
          ingredients: Json
          instruction_groups: Json | null
          instructions: string[]
          name: string
          notes: Json
          prep_time_minutes: number | null
          servings: number
          tags: string[] | null
          total_time_minutes: number | null
          updated_at: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recipes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_recipe_history_stats: {
        Args: { p_user_id: string }
        Returns: {
          last_made: string
          recipe_id: string
          times_made: number
        }[]
      }
      insert_default_recipes_for_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      merge_tags: {
        Args: { p_source_tag: string; p_target_tag: string; p_user_id: string }
        Returns: undefined
      }
      move_shopping_item_to_pantry: {
        Args: { p_pantry_qty: number; p_pantry_unit: string; p_row_id: string }
        Returns: {
          pantry_item: Json
          pantry_was_inserted: boolean
          removed_item: Json
          shopping_list_updated_at: string
        }[]
      }
      rename_tag: {
        Args: { p_new_tag: string; p_old_tag: string; p_user_id: string }
        Returns: undefined
      }
      toggle_shopping_item_checked: {
        Args: { p_row_id: string }
        Returns: {
          checked: boolean
          row_id: string
          updated_at: string
        }[]
      }
      toggle_weekly_recipe_made: {
        Args: {
          p_date_made?: string
          p_is_made_for_week: boolean
          p_recipe_id: string
          p_week_date: string
        }
        Returns: {
          action: string
          history_date_made: string
          made_recipe_ids: string[]
          recipe_id: string
          week_date: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
