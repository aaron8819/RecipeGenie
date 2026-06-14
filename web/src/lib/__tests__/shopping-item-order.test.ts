import { describe, expect, it } from "vitest"
import type { ShoppingItem } from "@/types/database"
import {
  learnShoppingItemOrderPreferences,
  normalizeShoppingItemOrderPreferences,
  sortShoppingItemsByPreferences,
} from "../shopping-item-order"

function item(name: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    rowId: `row-${name}`,
    item: name,
    amount: null,
    unit: "",
    categoryKey: "produce",
    categoryOrder: 1,
    sources: [],
    ...overrides,
  }
}

describe("shopping item order preferences", () => {
  it("sorts known items by learned category order and unknown items alphabetically after them", () => {
    const sorted = sortShoppingItemsByPreferences(
      [
        item("cilantro"),
        item("avocado"),
        item("arugula"),
        item("lime"),
        item("garlic"),
      ],
      {
        produce: ["lime", "avocado", "garlic"],
      }
    )

    expect(sorted.map((entry) => entry.item)).toEqual([
      "lime",
      "avocado",
      "garlic",
      "arugula",
      "cilantro",
    ])
  })

  it("learns current category order without dropping older absent preferences", () => {
    const learned = learnShoppingItemOrderPreferences(
      {
        produce: ["blueberries", "guacamole", "avocado", "tomato", "onion", "garlic"],
      },
      [
        item("tomato"),
        item("garlic"),
        item("cilantro"),
      ]
    )

    expect(learned.produce).toEqual([
      "blueberries",
      "guacamole",
      "avocado",
      "tomato",
      "garlic",
      "cilantro",
      "onion",
    ])
  })

  it("normalizes malformed persisted preference payloads", () => {
    expect(
      normalizeShoppingItemOrderPreferences({
        produce: [" Lime ", "lime", "", 1, "Avocado"],
        pantry: "not-array",
      })
    ).toEqual({
      produce: ["lime", "avocado"],
    })
  })
})
