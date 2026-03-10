import { describe, expect, it } from "vitest"
import type { ShoppingItem } from "@/types/database"
import {
  buildCategoryViewModel,
  deriveCheckedPartition,
  deriveOrderedCategories,
  deriveSortableItemIds,
  deriveVisibleShoppingItems,
  groupItemsByCategory,
  prioritizeUncheckedItems,
  sortItemsWithinGroups,
} from "../shopping-list.selectors"

function item(overrides: Partial<ShoppingItem>): ShoppingItem {
  return {
    rowId: `row-${overrides.item || "item"}-${overrides.unit || "unit"}-${overrides.amount ?? "null"}`,
    item: "item",
    amount: null,
    unit: "",
    checked: false,
    categoryKey: "misc",
    categoryOrder: 99,
    sources: [],
    ...overrides,
  }
}

describe("shopping-list selectors", () => {
  it("groups items by category with stable membership", () => {
    const items = [
      item({ item: "chicken", categoryKey: "meat" }),
      item({ item: "spinach", categoryKey: "produce" }),
      item({ item: "beef", categoryKey: "meat" }),
    ]

    const grouped = groupItemsByCategory(items)

    expect(Object.keys(grouped).sort()).toEqual(["meat", "produce"])
    expect(grouped.meat.map((i) => i.item)).toEqual(["chicken", "beef"])
    expect(grouped.produce.map((i) => i.item)).toEqual(["spinach"])
  })

  it("keeps deterministic ordering within groups", () => {
    const grouped = {
      meat: [item({ item: "a" }), item({ item: "b" }), item({ item: "c" })],
    }

    const run1 = sortItemsWithinGroups(grouped)
    const run2 = sortItemsWithinGroups(grouped)

    expect(run1.meat.map((i) => i.item)).toEqual(["a", "b", "c"])
    expect(run2.meat.map((i) => i.item)).toEqual(["a", "b", "c"])
  })

  it("partitions checked and unchecked counts correctly", () => {
    const items = [
      item({ item: "a", checked: true }),
      item({ item: "b", checked: false }),
      item({ item: "c", checked: true }),
    ]

    expect(deriveCheckedPartition(items)).toEqual({
      totalCount: 3,
      checkedCount: 2,
      uncheckedCount: 1,
      allChecked: false,
    })
    expect(deriveCheckedPartition([item({ item: "x", checked: true })]).allChecked).toBe(true)
  })

  it("keeps unchecked rows ahead of checked rows without changing relative order", () => {
    const items = [
      item({ rowId: "row-a", item: "apples", checked: true }),
      item({ rowId: "row-b", item: "bananas", checked: false }),
      item({ rowId: "row-c", item: "carrots", checked: false }),
      item({ rowId: "row-d", item: "dates", checked: true }),
    ]

    expect(prioritizeUncheckedItems(items).map((entry) => entry.rowId)).toEqual([
      "row-b",
      "row-c",
      "row-a",
      "row-d",
    ])
  })

  it("filters visible items for pending item and recipe deletions", () => {
    const items = [
      item({
        item: "garlic",
        sources: [{ recipeName: "Stew" }],
      }),
      item({
        item: "onion",
        sources: [{ recipeName: "Pasta" }],
      }),
      item({
        item: "salt",
        sources: [],
      }),
    ]

    expect(deriveVisibleShoppingItems(items).map((i) => i.item)).toEqual([
      "garlic",
      "onion",
      "salt",
    ])
  })

  it("builds a category view model with deterministic category order and counts", () => {
    const items = [
      item({ item: "apple", categoryKey: "produce", checked: false }),
      item({ item: "banana", categoryKey: "produce", checked: true }),
      item({ item: "beef", categoryKey: "protein", checked: false }),
    ]
    const grouped = groupItemsByCategory(items)
    const ordered = deriveOrderedCategories({
      customCategories: null,
      categoryOrder: ["produce", "protein"],
    })
    const vm = buildCategoryViewModel(grouped, ordered)

    expect(vm.map((c) => c.key)).toEqual(["produce", "protein"])
    expect(vm[0].checkedCount).toBe(1)
    expect(vm[0].totalCount).toBe(2)
    expect(vm[1].checkedCount).toBe(0)
    expect(vm[1].totalCount).toBe(1)
  })

  it("derives sortable ids from stable row identity instead of item name", () => {
    const items = [
      item({ rowId: "row-1", item: "milk", unit: "cup" }),
      item({ rowId: "row-2", item: "milk", unit: "bottle" }),
    ]

    expect(deriveSortableItemIds(items)).toEqual(["row-1", "row-2"])
  })
})
