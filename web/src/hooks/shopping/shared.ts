/**
 * Shared constants and helpers for shopping hooks
 */

// Query keys
export const SHOPPING_KEY = ["shopping_list"]
export const PANTRY_KEY = ["pantry"]
export const CONFIG_KEY = ["user_config"]

// React Query mutation scope ID to serialize shopping_list writes and avoid lost updates.
export const SHOPPING_LIST_WRITE_SCOPE_ID = "shopping-list-write"
