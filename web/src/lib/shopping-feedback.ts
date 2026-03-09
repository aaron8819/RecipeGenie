export interface ShoppingAddResultSummary {
  added: number
  merged: number
}

interface CountLabel {
  singular: string
  plural: string
}

interface ShoppingAddMessageOptions {
  sourceName?: string
  itemLabel?: CountLabel
  zeroMessage?: string
}

function formatCount(count: number, label: CountLabel) {
  return `${count} ${count === 1 ? label.singular : label.plural}`
}

export function formatShoppingAddMessage(
  result: ShoppingAddResultSummary,
  options: ShoppingAddMessageOptions = {}
) {
  const itemLabel = options.itemLabel ?? {
    singular: "item",
    plural: "items",
  }
  const sourceSuffix = options.sourceName ? ` from "${options.sourceName}"` : ""

  if (result.added > 0 && result.merged > 0) {
    return `Added ${formatCount(result.added, itemLabel)}${sourceSuffix} to shopping list; updated ${formatCount(result.merged, itemLabel)} already there`
  }

  if (result.added > 0) {
    return `Added ${formatCount(result.added, itemLabel)}${sourceSuffix} to shopping list`
  }

  if (result.merged > 0) {
    return `Updated ${formatCount(result.merged, itemLabel)}${sourceSuffix} already on the shopping list`
  }

  return options.zeroMessage ?? `Everything${sourceSuffix} is already on the shopping list`
}

export function isAlreadyInShoppingListError(error: unknown) {
  if (error instanceof Error) {
    return error.message === "Item already in shopping list"
  }

  if (typeof error === "string") {
    return error === "Item already in shopping list"
  }

  return false
}
