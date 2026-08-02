import { describe, expect, it } from "vitest"
import type { Ingredient } from "@/types/database"
import { matchIngredientExclusionFamily } from "../ingredient-exclusion-families"

function ingredient(
  item: string,
  overrides: Partial<Ingredient> = {}
): Ingredient {
  return { item, amount: null, unit: "", ...overrides }
}

describe("matchIngredientExclusionFamily", () => {
  const aliases = [
    ["salt", "salt"],
    ["kosher salt", "salt"],
    ["sea salt", "salt"],
    ["table salt", "salt"],
    ["black pepper", "black-pepper"],
    ["ground black pepper", "black-pepper"],
    ["freshly ground black pepper", "black-pepper"],
    ["cracked black pepper", "black-pepper"],
  ] as const

  it.each(aliases)("matches %s", (itemName, family) => {
    expect(matchIngredientExclusionFamily(ingredient(itemName))).toBe(family)
  })

  it.each(aliases)("matches terminal to taste for %s in the item", (itemName, family) => {
    expect(matchIngredientExclusionFamily(ingredient(`${itemName} to taste`))).toBe(family)
  })

  it.each(aliases)("matches terminal to taste for %s in the modifier", (itemName, family) => {
    expect(matchIngredientExclusionFamily(ingredient(itemName, { modifier: "  TO   TASTE " }))).toBe(family)
  })

  it("normalizes only case and whitespace", () => {
    expect(matchIngredientExclusionFamily(ingredient("  Freshly   Ground BLACK Pepper  "))).toBe("black-pepper")
  })

  it.each([
    "salt.",
    "black-pepper",
    "salt,",
    "(salt)",
  ])("preserves punctuation in %s", (itemName) => {
    expect(matchIngredientExclusionFamily(ingredient(itemName))).toBeNull()
  })

  it.each([
    "garlic salt",
    "celery salt",
    "seasoned salt",
    "Himalayan salt",
    "flaky salt",
    "coarse salt",
    "salted butter",
    "saltine crackers",
    "pepper",
    "white pepper",
    "mixed peppercorns",
    "red pepper flakes",
    "bell pepper",
    "poblano pepper",
    "pepper jack cheese",
    "pepperoni",
    "salt and pepper to taste",
    "salt and freshly ground black pepper",
    "salt, pepper, and garlic powder",
    "oil or butter",
  ])("rejects unsupported or compound item %s", (itemName) => {
    expect(matchIngredientExclusionFamily(ingredient(itemName))).toBeNull()
  })

  it("rejects any non-empty alternative", () => {
    expect(matchIngredientExclusionFamily(ingredient("salt", { alternatives: ["", "pepper"] }))).toBeNull()
  })

  it("allows an alternatives array containing only empty entries", () => {
    expect(matchIngredientExclusionFamily(ingredient("salt", { alternatives: ["  "] }))).toBe("salt")
  })

  it.each(["finely ground", "optional", "as needed", "to taste."])(
    "rejects unsupported modifier %s",
    (modifier) => {
      expect(matchIngredientExclusionFamily(ingredient("salt", { modifier }))).toBeNull()
    }
  )

  it("does not use originalText as matching evidence", () => {
    expect(matchIngredientExclusionFamily(ingredient("seasoning", { originalText: "salt" }))).toBeNull()
  })
})
