import { describe, expect, it } from "vitest"
import { reorderByFilteredIndices } from "@/lib/shopping-reorder"
import type { ShoppingItem } from "@/types/database"

function item(name: string, rowId: string, categoryKey = "misc", categoryOrder = 8): ShoppingItem {
  return {
    rowId,
    item: name,
    amount: null,
    unit: "",
    categoryKey,
    categoryOrder,
    sources: [{ recipeId: "r1", recipeName: "Recipe 1" }],
  }
}

describe("reorderByFilteredIndices", () => {
  it("reorders using row ids from the full list", () => {
    const items = [
      item("a", "row-a"),
      item("milk", "row-milk-cup"),
      item("c", "row-c"),
      item("milk", "row-milk-bottle"),
    ]

    const result = reorderByFilteredIndices(items, "row-milk-bottle", "row-milk-cup")

    expect(result).not.toBeNull()
    expect(result!.newItems.map((candidate) => candidate.rowId)).toEqual([
      "row-a",
      "row-milk-bottle",
      "row-milk-cup",
      "row-c",
    ])
  })

  it("returns null when either row id is missing", () => {
    const items = [item("a", "row-a"), item("b", "row-b")]

    expect(reorderByFilteredIndices(items, "", "row-b")).toBeNull()
    expect(reorderByFilteredIndices(items, "row-a", "")).toBeNull()
  })

  it("returns null when row ids cannot be mapped to the full list", () => {
    const items = [item("a", "row-a"), item("b", "row-b")]

    expect(reorderByFilteredIndices(items, "row-x", "row-b")).toBeNull()
  })
})
