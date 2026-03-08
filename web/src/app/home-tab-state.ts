export const HOME_VALID_TABS = ["recipes", "planner", "pantry", "shopping"] as const
export const HOME_TAB_STORAGE_KEY = "recipe-genie-active-tab"
export const HOME_TAB_COOKIE = "recipe-genie-active-tab"
export const HOME_DEFAULT_TAB = "recipes"

export type HomeTab = (typeof HOME_VALID_TABS)[number]

export function isValidHomeTab(tab: string): tab is HomeTab {
  return HOME_VALID_TABS.includes(tab as HomeTab)
}

export function normalizeHomeTab(tab: string | undefined): HomeTab {
  return tab && isValidHomeTab(tab) ? tab : HOME_DEFAULT_TAB
}
