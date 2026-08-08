import { describe, expect, it } from "vitest"
import type { PantryItem } from "@/types/database"
import { groupPantryItems, sortExactExclusions } from "../pantry"

function pantryItem(id: string, item: string): PantryItem {
  return {
    id,
    item,
    user_id: "user-1",
    created_at: null,
  }
}

describe("groupPantryItems", () => {
  it("uses Shopping order and names while alphabetizing each category", () => {
    const groups = groupPantryItems([
      pantryItem("4", "zucchini"),
      pantryItem("3", "apple"),
      pantryItem("2", "sugar"),
      pantryItem("1", "flour"),
    ])

    expect(groups.map((group) => group.name)).toEqual([
      "Fresh Produce",
      "Pantry Staples",
    ])
    expect(groups[0].items.map((item) => item.item)).toEqual([
      "apple",
      "zucchini",
    ])
    expect(groups[1].items.map((item) => item.item)).toEqual([
      "flour",
      "sugar",
    ])
  })

  it("places unmatched ingredients in Other after matched categories", () => {
    const groups = groupPantryItems([
      pantryItem("1", "za'atar blend from neighbor"),
      pantryItem("2", "milk"),
      pantryItem("3", "another mystery ingredient"),
    ])

    expect(groups.map((group) => group.name)).toEqual(["Dairy", "Other"])
    expect(groups[1].items.map((item) => item.item)).toEqual([
      "another mystery ingredient",
      "za'atar blend from neighbor",
    ])
  })
})

describe("sortExactExclusions", () => {
  it("returns a case-insensitive alphabetical copy", () => {
    const keywords = ["Worcestershire sauce", "anchovies", "Capers"]

    expect(sortExactExclusions(keywords)).toEqual([
      "anchovies",
      "Capers",
      "Worcestershire sauce",
    ])
    expect(keywords).toEqual([
      "Worcestershire sauce",
      "anchovies",
      "Capers",
    ])
  })
})
