import type { ShoppingRecipeEntryV2 } from './shopping-document'
import type { ShoppingItem } from '@/types/database'

export function shoppingRecipeSelections(entries: Record<string, ShoppingRecipeEntryV2>) {
  const sorted = Object.values(entries).sort((a, b) =>
    a.recipeName.localeCompare(b.recipeName) || a.recipeId.localeCompare(b.recipeId))
  return sorted.map((entry) => {
    const peers = sorted.filter((other) => other.recipeName === entry.recipeName)
    // Ordinals distinguish even identical snapshots without displaying UUIDs.
    const label = peers.length > 1
      ? `${entry.recipeName} (${peers.indexOf(entry) + 1})` : entry.recipeName
    return { recipeId: entry.recipeId, recipeName: entry.recipeName, label,
      selectedServings: entry.selectedServings }
  })
}

export function isManualShoppingItem(item: ShoppingItem) {
  return item.rowId?.startsWith('manual:') === true
}

// One navigation control per persisted source; quantity details still consume
// every occurrence. Missing IDs are never invented or deduplicated by title.
export function shoppingSourceControls(item: ShoppingItem) {
  const seen = new Set<string>()
  return (item.sources ?? []).filter((source) => {
    const key = source.recipeId ? `recipe:${source.recipeId}` : source.manualId ? `manual:${source.manualId}` : undefined
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function shoppingSourceLabel(source: NonNullable<ShoppingItem['sources']>[number]) {
  return source.label ?? source.recipeName
}
