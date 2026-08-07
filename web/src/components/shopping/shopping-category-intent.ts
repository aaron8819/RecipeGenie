import type { ShoppingItem } from "@/types/database"
import { requireShoppingRowRef } from "@/lib/shopping-row-reference"

export type CategoryIntent = "expanded" | "collapsed"
export type CategoryIntentByKey = Map<string, CategoryIntent>

type CategoryContent = {
  checkedRowIds: Set<string>
  uncheckedRowIds: Set<string>
}

export type CategoryContentByKey = Map<string, CategoryContent>

export function deriveCategoryContent(items: ShoppingItem[]): CategoryContentByKey {
  const contentByKey: CategoryContentByKey = new Map()

  items.forEach((item) => {
    const categoryKey = item.categoryKey || "misc"
    const content = contentByKey.get(categoryKey) || {
      checkedRowIds: new Set<string>(),
      uncheckedRowIds: new Set<string>(),
    }
    const target = item.checked ? content.checkedRowIds : content.uncheckedRowIds
    target.add(requireShoppingRowRef(item, "category expansion state"))
    contentByKey.set(categoryKey, content)
  })

  return contentByKey
}

export function reconcileCategoryIntents(
  intents: CategoryIntentByKey,
  previousContent: CategoryContentByKey,
  currentContent: CategoryContentByKey
): CategoryIntentByKey {
  const next = new Map(intents)

  for (const categoryKey of next.keys()) {
    if (!currentContent.has(categoryKey)) next.delete(categoryKey)
  }

  for (const [categoryKey, current] of currentContent) {
    const previous = previousContent.get(categoryKey)
    if (!previous) {
      next.delete(categoryKey)
      continue
    }

    const hasNewlyUncheckedRow = [...current.uncheckedRowIds].some(
      (rowId) => !previous.uncheckedRowIds.has(rowId)
    )
    const justCompleted =
      previous.uncheckedRowIds.size > 0 && current.uncheckedRowIds.size === 0

    if (hasNewlyUncheckedRow || justCompleted) next.delete(categoryKey)
  }

  return next
}

export function isCategoryExpanded(
  intent: CategoryIntent | undefined,
  uncheckedCount: number
): boolean {
  return intent ? intent === "expanded" : uncheckedCount > 0
}

export function categoryIntentMapsEqual(
  left: CategoryIntentByKey,
  right: CategoryIntentByKey
): boolean {
  if (left.size !== right.size) return false
  for (const [key, intent] of left) {
    if (right.get(key) !== intent) return false
  }
  return true
}
