import { describe, expect, it } from "vitest"
import type { ShoppingItem } from "@/types/database"
import {
  deriveCategoryContent,
  isCategoryExpanded,
  reconcileCategoryIntents,
  type CategoryIntentByKey,
} from "../shopping-category-intent"

function item(
  rowId: string,
  categoryKey: string,
  checked = false
): ShoppingItem {
  return {
    rowId,
    item: rowId,
    amount: 1,
    unit: "",
    categoryKey,
    categoryOrder: 1,
    checked,
    sources: [{ recipeName: "Manual" }],
  }
}

function reconcile(
  intents: CategoryIntentByKey,
  previousItems: ShoppingItem[],
  currentItems: ShoppingItem[]
) {
  return reconcileCategoryIntents(
    intents,
    deriveCategoryContent(previousItems),
    deriveCategoryContent(currentItems)
  )
}

describe("shopping category expansion intent", () => {
  it("derives initial defaults from content without storing them", () => {
    expect(isCategoryExpanded(undefined, 1)).toBe(true)
    expect(isCategoryExpanded(undefined, 0)).toBe(false)
    expect(isCategoryExpanded("collapsed", 2)).toBe(false)
    expect(isCategoryExpanded("expanded", 0)).toBe(true)
  })

  it("preserves explicit intent across ordinary content changes and category reordering", () => {
    const produce = item("produce-1", "produce")
    const dairy = item("dairy-1", "dairy")
    const intents = new Map([
      ["produce", "collapsed"],
      ["dairy", "expanded"],
    ]) as CategoryIntentByKey

    const next = reconcile(intents, [produce, dairy], [dairy, produce])

    expect([...next]).toEqual([...intents])
  })

  it("does not mistake stable-row reordering or projection updates for new content", () => {
    const first = item("produce-1", "produce")
    const second = item("produce-2", "produce")
    const collapsed = new Map([["produce", "collapsed"]]) as CategoryIntentByKey

    const next = reconcile(
      collapsed,
      [first, second],
      [{ ...second, amount: 3 }, { ...first, sources: [{ recipeName: "Updated" }] }]
    )

    expect([...next]).toEqual([...collapsed])
  })

  it("clears stale collapse intent for a new unchecked manual or recipe-derived row", () => {
    const existing = item("existing", "produce")
    const collapsed = new Map([["produce", "collapsed"]]) as CategoryIntentByKey

    expect(reconcile(collapsed, [existing], [existing, item("manual-new", "produce")]).has("produce"))
      .toBe(false)
    expect(reconcile(collapsed, [existing], [existing, {
      ...item("recipe-new", "produce"),
      sources: [{ recipeName: "Soup", recipeId: "recipe-1" }],
    }]).has("produce")).toBe(false)
  })

  it("clears stale collapse intent when an existing completed row becomes unchecked", () => {
    const checked = item("row-1", "produce", true)
    const collapsed = new Map([["produce", "collapsed"]]) as CategoryIntentByKey

    expect(reconcile(collapsed, [checked], [{ ...checked, checked: false }]).has("produce"))
      .toBe(false)
  })

  it("clears prior expansion intent when the final unchecked row is completed", () => {
    const active = item("row-1", "produce")
    const expanded = new Map([["produce", "expanded"]]) as CategoryIntentByKey

    expect(reconcile(expanded, [active], [{ ...active, checked: true }]).has("produce"))
      .toBe(false)
  })

  it("keeps a manually reopened completed category expanded for the mounted session", () => {
    const completed = item("row-1", "produce", true)
    const expanded = new Map([["produce", "expanded"]]) as CategoryIntentByKey

    const next = reconcile(expanded, [completed], [completed])
    expect(isCategoryExpanded(next.get("produce"), 0)).toBe(true)
  })

  it("deletes intent when a category empties and recomputes defaults when repopulated", () => {
    const active = item("row-1", "custom-market")
    const collapsed = new Map([["custom-market", "collapsed"]]) as CategoryIntentByKey

    const empty = reconcile(collapsed, [active], [])
    const repopulated = reconcile(empty, [], [active])

    expect(empty.has("custom-market")).toBe(false)
    expect(isCategoryExpanded(repopulated.get("custom-market"), 1)).toBe(true)
  })

  it("treats restored and replacement unchecked rows as newly relevant content", () => {
    const original = item("recipe-old", "produce")
    const collapsed = new Map([["produce", "collapsed"]]) as CategoryIntentByKey

    const pantryRestored = reconcile(collapsed, [original], [original, item("pantry-row", "produce")])
    const exclusionRestored = reconcile(collapsed, [original], [original, item("excluded-row", "produce")])
    const contributionReplaced = reconcile(collapsed, [original], [item("recipe-new", "produce")])

    expect(pantryRestored.has("produce")).toBe(false)
    expect(exclusionRestored.has("produce")).toBe(false)
    expect(contributionReplaced.has("produce")).toBe(false)
  })

  it("limits contribution replacement reconciliation to the affected category", () => {
    const produce = item("produce-row", "produce")
    const dairy = item("dairy-old", "dairy")
    const collapsed = new Map([
      ["produce", "collapsed"],
      ["dairy", "collapsed"],
    ]) as CategoryIntentByKey

    const next = reconcile(collapsed, [produce, dairy], [produce, item("dairy-new", "dairy")])

    expect(next.get("produce")).toBe("collapsed")
    expect(next.has("dairy")).toBe(false)
  })
})
