import type { UserConfig } from "@/types/database"

export const DEFAULT_RECIPE_CATEGORIES = ["chicken", "beef", "turkey", "lamb", "vegetarian"]
export const DEFAULT_RECIPE_SELECTION: Record<string, number> = {
  chicken: 2,
  beef: 1,
  turkey: 1,
  lamb: 1,
  vegetarian: 1,
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  user_id: "",
  categories: [...DEFAULT_RECIPE_CATEGORIES],
  default_selection: { ...DEFAULT_RECIPE_SELECTION },
  exclude_salt_variants: false,
  exclude_black_pepper_variants: false,
  excluded_keywords: [],
  history_exclusion_days: 10,
  week_start_day: 1,
  onboarding_completed_at: null,
  category_overrides: {},
  custom_categories: [],
  shopping_item_order: {},
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
  return {
    ...data,
    exclude_salt_variants: data?.exclude_salt_variants ?? false,
    exclude_black_pepper_variants:
      data?.exclude_black_pepper_variants ?? false,
    shopping_item_order: data?.shopping_item_order ?? {},
  } as UserConfig
}
