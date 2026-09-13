import { shoppingRecipeSelections } from './shopping-sources'
import { projectShoppingDocument, type ShoppingDocumentStateV3 } from './shopping-document'
import type { PantryItem, ShoppingItem, ShoppingList, ShoppingConfig } from '@/types/database'

export function shoppingDocumentToList(
  userId: string,
  state: ShoppingDocumentStateV3,
  pantryItems: PantryItem[] = []
): ShoppingList {
  const selections = shoppingRecipeSelections(state.document.recipeEntries)
  const labels = new Map(selections.map((entry) => [entry.recipeId, entry.label]))
  const projection = projectShoppingDocument(state.document, pantryItems)
  const mapRow = (row: (typeof projection.rows)[number]): ShoppingItem => ({
    ...(state.document.schemaVersion === 4 ? {
      coveragePending: true, legacyAmount: row.legacy, previousChecked: row.previousChecked,
      manualVersion: row.manualId ? state.document.manualItems.find(item => item.id === row.manualId)?.identity?.version : undefined,
      requirementBreakdown: row.requirements?.map(part => ({ label: part.manualId ? `Extra / reminder: ${part.displayName}` : part.displayName,
        quantity: part.quantity, hidden: part.bucket !== 'items' })),
    } : {}),
    rowId: row.rowRef,
    orderingKey: row.orderingKey,
    item: row.displayName,
    amount: row.quantity?.amount ?? null,
    unit: row.quantity?.unit || '',
    categoryKey: row.categoryKey,
    categoryOrder: row.categoryOrder,
    sources: row.manualId
      ? [{ manualId: row.manualId, recipeName: 'Manual' }]
      : row.sources.map((source) => ({
          ...source,
          label: labels.get(source.recipeId),
        })),
    quantityParts: [
      row.quantity ?? { amount: null, unit: '' },
      ...(row.additionalQuantities ?? []),
    ],
    checked: row.checked,
    excludedBy: row.excludedBy,
  })
  const entries = Object.values(state.document.recipeEntries)
  return {
    user_id: userId,
    items: projection.items.map(mapRow),
    already_have: projection.alreadyHave.map(mapRow),
    excluded: projection.excluded.map(mapRow),
    source_recipes: entries.map((entry) => entry.recipeId).sort(),
    scale: entries.length === 1
      ? Number(entries[0].scaleV1.numerator) / Number(entries[0].scaleV1.denominator)
      : 1,
    total_servings: entries.reduce((total, entry) => total + entry.selectedServings, 0),
    custom_order: Object.keys(
      state.document.preferences.ingredientOrderByCategory
    ).length > 0,
  }
}

export function shoppingDocumentToConfig(
  state: ShoppingDocumentStateV3
): ShoppingConfig {
  const preferences = state.document.preferences
  return {
    category_overrides: { ...preferences.categoryByIngredient },
    custom_categories: [...preferences.customCategories],
    category_order: preferences.categoryOrder.length > 0
      ? [...preferences.categoryOrder]
      : null,
    excluded_keywords: [...preferences.excludedIngredientKeys],
    exclude_salt_variants: preferences.excludeSaltVariants,
    exclude_black_pepper_variants: preferences.excludeBlackPepperVariants,
  }
}
