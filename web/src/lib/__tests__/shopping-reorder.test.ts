import { describe, expect, it } from "vitest"
import { resolveShoppingDropIntent } from "@/lib/shopping-reorder"
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

describe("resolveShoppingDropIntent", () => {
  it("resolves an upward drop as insertion before the target", () => {
    const items = [
      item("a", "row-a"),
      item("milk", "row-milk-cup"),
      item("c", "row-c"),
      item("milk", "row-milk-bottle"),
    ]

    const result = resolveShoppingDropIntent(items, "row-milk-bottle", "row-milk-cup")

    expect(result).toMatchObject({
      draggedItem: { rowId: "row-milk-bottle" },
      targetItem: { rowId: "row-milk-cup" },
      placement: "before",
    })
  })

  it("resolves a downward drop as insertion after the target", () => {
    const items = [item("a", "row-a"), item("b", "row-b")]
    expect(resolveShoppingDropIntent(items, "row-a", "row-b")?.placement)
      .toBe("after")
  })

  it("returns null when either row id is missing", () => {
    const items = [item("a", "row-a"), item("b", "row-b")]

    expect(resolveShoppingDropIntent(items, "", "row-b")).toBeNull()
    expect(resolveShoppingDropIntent(items, "row-a", "")).toBeNull()
  })

  it("returns null when row ids cannot be mapped to the full list", () => {
    const items = [item("a", "row-a"), item("b", "row-b")]

    expect(resolveShoppingDropIntent(items, "row-x", "row-b")).toBeNull()
  })
})
