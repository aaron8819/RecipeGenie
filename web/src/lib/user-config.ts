import type { UserConfig } from "@/types/database"

export const DEFAULT_USER_CONFIG: UserConfig = {
  user_id: "",
  categories: ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"],
  default_selection: { chicken: 2, turkey: 1, steak: 1 },
  excluded_keywords: [],
  history_exclusion_days: 10,
  week_start_day: 1,
  onboarding_completed_at: null,
  category_overrides: {},
  custom_categories: [],
  category_order: null,
  excluded_days: [],
  preferred_days: null,
  auto_assign_days: true,
  enabled_planner_categories: null,
}

export function resolveUserConfig(
  data: UserConfig | null,
  error: { code?: string } | null
): UserConfig {
  if (error) {
    if (error.code === "PGRST116") {
      return DEFAULT_USER_CONFIG
    }
    throw error
  }
  return data as UserConfig
}
