import { describe, expect, it } from "vitest"
import { parseIngredientLine } from "../recipe-parser"
import {
  resolveRecipeShoppingIngredients,
  resolveShoppingIngredient,
} from "../shopping-ingredient-resolution"

describe("resolveShoppingIngredient", () => {
  it("preserves normalized identity, display, scale, alternatives, and family evidence", () => {
    const ingredient = {
      item: "Kosher Salt",
      amount: 2,
      unit: "teaspoons",
      alternatives: ["Sea Salt"],
    }
    const original = structuredClone(ingredient)
    const result = resolveShoppingIngredient({
      ingredient,
      scale: 2,
      exactScaleV1: { numerator: "2", denominator: "1" },
      recipeId: "recipe-a",
      sourceOrdinal: 7,
    })

    expect(result).toMatchObject({
      ingredientKey: "kosher salt",
      displayName: "kosher salt (or sea salt)",
      quantity: { amount: 4, unit: "tsp" },
      purchaseUnit: "tsp",
      pantryMatchKeys: ["kosher salt", "sea salt"],
      sourceOrdinal: 7,
    })
    expect(result.exclusionFamily).toBeUndefined()
    expect(ingredient).toEqual(original)
  })

  it("retains exact range/package metadata and separates their aggregate identities", () => {
    const range = parseIngredientLine("1-2 cups milk")
    const packaged = parseIngredientLine("2 (14 oz) cans tomatoes")
    const resolvedRange = resolveShoppingIngredient({
      ingredient: range,
      recipeId: "recipe-a",
      exactScaleV1: { numerator: "1", denominator: "1" },
    })
    const resolvedPackage = resolveShoppingIngredient({
      ingredient: packaged,
      recipeId: "recipe-a",
      exactScaleV1: { numerator: "1", denominator: "1" },
    })

    expect(resolvedRange.quantity?.exactQuantityV1?.kind).toBe("range")
    expect(resolvedPackage.quantity?.exactPackageV1).toBeDefined()
    expect(resolvedRange.aggregateKey).not.toBe(resolvedPackage.aggregateKey)
  })

  it("uses source order but never array position in identity", () => {
    const sections = [
      { label: "First", ingredients: [{ item: "garlic", amount: 1, unit: "clove" }] },
      { label: "Second", ingredients: [{ item: "milk", amount: null, unit: "" }] },
    ]
    const results = resolveRecipeShoppingIngredients(sections, { recipeId: "recipe-a" })
    const moved = resolveShoppingIngredient({
      ingredient: sections[0].ingredients[0],
      recipeId: "recipe-a",
      sourceOrdinal: 99,
    })

    expect(results.map((result) => result.displayName)).toEqual(["garlic", "milk"])
    expect(results[0].aggregateKey).toBe(moved.aggregateKey)
    expect(results[1].quantity).toBeNull()
  })

  it("uses semantic range identity rather than authored punctuation", () => {
    const hyphen = resolveShoppingIngredient({
      ingredient: parseIngredientLine("1-2 cups milk"),
      recipeId: "recipe-a",
    })
    const enDash = resolveShoppingIngredient({
      ingredient: parseIngredientLine("1–2 cups milk"),
      recipeId: "recipe-a",
    })
    const differentRange = resolveShoppingIngredient({
      ingredient: parseIngredientLine("2-3 cups milk"),
      recipeId: "recipe-a",
    })
    expect(hyphen.aggregateKey).toBe(enDash.aggregateKey)
    expect(hyphen.aggregateKey).not.toBe(differentRange.aggregateKey)
  })

  it("keeps conservative ingredient distinctions while merging true equivalents", () => {
    const first = resolveShoppingIngredient({
      ingredient: { item: "apples", amount: 1, unit: "count" },
    })
    const equivalent = resolveShoppingIngredient({
      ingredient: { item: "apple", amount: 2, unit: "count" },
    })
    const distinct = resolveShoppingIngredient({
      ingredient: { item: "granny smith apple", amount: 1, unit: "count" },
    })

    expect(first.ingredientKey).toBe(equivalent.ingredientKey)
    expect(first.aggregateKey).toBe(equivalent.aggregateKey)
    expect(first.aggregateKey).not.toBe(distinct.aggregateKey)
  })
})
