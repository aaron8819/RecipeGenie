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
          day_assignment_recipe_uuids: Json
          day_assignments: Json | null
          id: string
          name: string
          recipe_ids: string[]
          recipe_uuids: string[]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category_selection?: Json | null
          created_at?: string | null
          day_assignment_recipe_uuids?: Json
          day_assignments?: Json | null
          id?: string
          name: string
          recipe_ids?: string[]
          recipe_uuids?: string[]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category_selection?: Json | null
          created_at?: string | null
          day_assignment_recipe_uuids?: Json
          day_assignments?: Json | null
          id?: string
          name?: string
          recipe_ids?: string[]
          recipe_uuids?: string[]
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
          recipe_uuid: string | null
          user_id: string
        }
        Insert: {
          date_made?: string
          id?: never
          recipe_id?: string
          recipe_uuid?: string | null
          user_id: string
        }
        Update: {
          date_made?: string
          id?: never
          recipe_id?: string
          recipe_uuid?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recipe_shares: {
        Row: {
          accepted_recipe_id: string | null
          accepted_recipe_uuid: string | null
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
          source_recipe_uuid: string | null
          status: string
        }
        Insert: {
          accepted_recipe_id?: string | null
          accepted_recipe_uuid?: string | null
          created_at?: string
          id?: string
          message?: string | null
          recipient_email: string
          recipient_user_id: string
          responded_at?: string | null
          sender_email: string
          sender_user_id: string
          source_recipe_id?: string
          source_recipe_snapshot: Json
          source_recipe_uuid?: string | null
          status?: string
        }
        Update: {
          accepted_recipe_id?: string | null
          accepted_recipe_uuid?: string | null
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
          source_recipe_uuid?: string | null
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
          ingredient_sections: Json
          instruction_sections: Json
          name: string
          notes: Json
          prep_time_minutes: number | null
          recipe_uuid: string
          servings: number
          tags: string[] | null
          total_time_minutes: number | null
          updated_at: string | null
          user_id: string
          yield_metadata: Json | null
        }
        Insert: {
          category: string
          cook_time_minutes?: number | null
          created_at?: string | null
          favorite?: boolean | null
          id: string
          image_url?: string | null
          ingredient_sections?: Json
          instruction_sections?: Json
          name: string
          notes?: Json
          prep_time_minutes?: number | null
          recipe_uuid: string
          servings?: number
          tags?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string | null
          user_id: string
          yield_metadata?: Json | null
        }
        Update: {
          category?: string
          cook_time_minutes?: number | null
          created_at?: string | null
          favorite?: boolean | null
          id?: string
          image_url?: string | null
          ingredient_sections?: Json
          instruction_sections?: Json
          name?: string
          notes?: Json
          prep_time_minutes?: number | null
          recipe_uuid?: string
          servings?: number
          tags?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string | null
          user_id?: string
          yield_metadata?: Json | null
        }
        Relationships: []
      }
      shopping_list: {
        Row: {
          content_revision: number
          document: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          content_revision?: number
          document?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          content_revision?: number
          document?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_config: {
        Row: {
          auto_assign_days: boolean | null
          categories: string[] | null
          default_selection: Json | null
          enabled_planner_categories: string[] | null
          excluded_days: number[] | null
          history_exclusion_days: number | null
          onboarding_completed_at: string | null
          preferred_days: number[] | null
          user_id: string
          week_start_day: number | null
        }
        Insert: {
          auto_assign_days?: boolean | null
          categories?: string[] | null
          default_selection?: Json | null
          enabled_planner_categories?: string[] | null
          excluded_days?: number[] | null
          history_exclusion_days?: number | null
          onboarding_completed_at?: string | null
          preferred_days?: number[] | null
          user_id: string
          week_start_day?: number | null
        }
        Update: {
          auto_assign_days?: boolean | null
          categories?: string[] | null
          default_selection?: Json | null
          enabled_planner_categories?: string[] | null
          excluded_days?: number[] | null
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
          day_assignment_recipe_uuids: Json
          day_assignments: Json | null
          generated_at: string | null
          made_recipe_ids: string[] | null
          made_recipe_uuids: string[]
          recipe_ids: string[]
          recipe_uuids: string[]
          scale: number | null
          user_id: string
          week_date: string
        }
        Insert: {
          day_assignment_recipe_uuids?: Json
          day_assignments?: Json | null
          generated_at?: string | null
          made_recipe_ids?: string[] | null
          made_recipe_uuids?: string[]
          recipe_ids?: string[]
          recipe_uuids?: string[]
          scale?: number | null
          user_id: string
          week_date: string
        }
        Update: {
          day_assignment_recipe_uuids?: Json
          day_assignments?: Json | null
          generated_at?: string | null
          made_recipe_ids?: string[] | null
          made_recipe_uuids?: string[]
          recipe_ids?: string[]
          recipe_uuids?: string[]
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
      delete_recipe: { Args: { p_recipe_uuid: string }; Returns: string }
      delete_tag: { Args: { p_tag: string }; Returns: undefined }
      filter_recipes_by_tags: {
        Args: { p_tags: string[] }
        Returns: {
          category: string
          cook_time_minutes: number | null
          created_at: string | null
          favorite: boolean | null
          id: string
          image_url: string | null
          ingredient_sections: Json
          instruction_sections: Json
          name: string
          notes: Json
          prep_time_minutes: number | null
          recipe_uuid: string
          servings: number
          tags: string[] | null
          total_time_minutes: number | null
          updated_at: string | null
          user_id: string
          yield_metadata: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "recipes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_recipe_history_stats: {
        Args: never
        Returns: {
          last_made: string
          recipe_id: string
          times_made: number
        }[]
      }
      get_recipe_identity_compat_usage: { Args: never; Returns: number }
      is_shopping_document_v2: { Args: { p_document: Json }; Returns: boolean }
      is_shopping_document_v3: { Args: { p_document: Json }; Returns: boolean }
      merge_tags: {
        Args: { p_source_tag: string; p_target_tag: string }
        Returns: undefined
      }
      move_shopping_document_item_to_pantry: {
        Args: {
          p_document: Json
          p_expected_revision: number
          p_item: string
          p_pantry_qty: number
          p_pantry_unit: string
        }
        Returns: {
          content_revision: number
          document: Json
          pantry_item: Json
          pantry_was_inserted: boolean
          updated_at: string
        }[]
      }
      rename_tag: {
        Args: { p_new_tag: string; p_old_tag: string }
        Returns: undefined
      }
      resolve_recipe_identity: {
        Args: { p_legacy_id?: string; p_recipe_uuid?: string }
        Returns: string
      }
      toggle_weekly_recipe_made: {
        Args: {
          p_made: boolean
          p_made_at?: string
          p_recipe_uuid: string
          p_week_date: string
        }
        Returns: {
          action: string
          history_date_made: string
          made_recipe_uuids: string[]
          recipe_uuid: string
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
