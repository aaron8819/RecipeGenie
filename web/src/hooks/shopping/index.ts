/**
 * Shopping hooks - modular exports
 *
 * This module provides all shopping-related React Query hooks,
 * split into domain-focused files for better maintainability.
 */

// Core list operations
export {
  useShoppingList,
  useGenerateShoppingList,
  useSaveShoppingList,
  useClearShoppingList,
} from "./use-shopping-list"

// Item operations (add, remove, check, reorder)
export {
  useAddShoppingItem,
  useRemoveShoppingItem,
  useCheckOffItem,
  useBulkCheckOff,
  useReorderShoppingList,
} from "./use-shopping-items"

// Recipe operations (add/remove recipe items)
export {
  useRemoveRecipeItems,
  useAddToShoppingList,
} from "./use-shopping-recipes"

// Category operations
export {
  useSaveCategoryOverride,
  useUpdateItemCategory,
} from "./use-shopping-categories"

// Config operations
export {
  useShoppingConfig,
  useUpdateShoppingConfig,
} from "./use-shopping-config"

// Pantry integration
export {
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
  useAddToPantryAndRemove,
} from "./use-shopping-pantry"

// Re-export shared constants for advanced usage
export { SHOPPING_KEY, PANTRY_KEY, CONFIG_KEY } from "./shared"
