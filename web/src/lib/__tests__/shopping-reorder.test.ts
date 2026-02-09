import { describe, expect, it } from "vitest"
import { reorderByFilteredIndices } from "@/lib/shopping-reorder"
import type { ShoppingItem } from "@/types/database"

function item(name: string, categoryKey = "misc", categoryOrder = 8): ShoppingItem {
  return {
    item: name,
    amount: null,
    unit: "",
    categoryKey,
    categoryOrder,
    sources: [{ recipeId: "r1", recipeName: "Recipe 1" }],
  }
}

describe("reorderByFilteredIndices", () => {
  it("reorders using actual indices from the full list", () => {
    const items = [item("a"), item("b"), item("c"), item("d")]
    const filtered = [item("b"), item("d")]

    const result = reorderByFilteredIndices(items, filtered, 1, 0)

    expect(result).not.toBeNull()
    expect(result!.newItems.map((i) => i.item)).toEqual(["a", "d", "b", "c"])
  })

  it("returns null for out-of-range filtered indices", () => {
    const items = [item("a"), item("b")]
    const filtered = [item("b")]

    expect(reorderByFilteredIndices(items, filtered, -1, 0)).toBeNull()
    expect(reorderByFilteredIndices(items, filtered, 0, 2)).toBeNull()
  })

  it("returns null when filtered items cannot be mapped to full list", () => {
    const items = [item("a"), item("b")]
    const filtered = [item("x"), item("b")]

    expect(reorderByFilteredIndices(items, filtered, 0, 1)).toBeNull()
  })
})
