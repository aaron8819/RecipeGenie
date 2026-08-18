import { describe, expect, it } from "vitest"

import {
  addIngredientSection,
  addIngredientToSection,
  addUnsectionedIngredient,
  moveIngredientToSection,
  removeEmptyIngredientSection,
  removeIngredientFromSection,
  renameIngredientSection,
  reorderIngredientsWithinSection,
} from "@/lib/recipe-ingredient-editor"
import { resolveShoppingIngredient } from "@/lib/shopping-ingredient-resolution"
import { flattenRecipeIngredients } from "@/lib/recipe-structure"
import type {
  CanonicalIngredient,
  IngredientSection,
} from "@/types/database"

const ingredient = (
  item: string,
  extra: Partial<CanonicalIngredient> = {}
): CanonicalIngredient => ({ item, amount: 1, unit: "count", ...extra })

const sections: IngredientSection[] = [
  {
    label: "For Serving",
    ingredients: [ingredient("pita"), ingredient("tomato")],
  },
  {
    label: null,
    ingredients: [ingredient("feta"), ingredient("cilantro", {
      alternatives: ["parsley"],
    })],
  },
]

describe("recipe ingredient editor section operations", () => {
  it("moves ingredients between named and unsectioned sections explicitly", () => {
    const intoNamed = moveIngredientToSection(sections, 1, 0, 0)
    expect(intoNamed).toEqual([
      {
        label: "For Serving",
        ingredients: [ingredient("pita"), ingredient("tomato"), ingredient("feta")],
      },
      {
        label: null,
        ingredients: [ingredient("cilantro", { alternatives: ["parsley"] })],
      },
    ])

    const backToUnsectioned = moveIngredientToSection(intoNamed, 0, 2, 1)
    expect(backToUnsectioned[1].ingredients.map(({ item }) => item)).toEqual([
      "cilantro",
      "feta",
    ])
  })

  it("moves between named sections and creates Unsectioned when needed", () => {
    const namedOnly: IngredientSection[] = [
      { label: "Sauce", ingredients: [ingredient("butter")] },
      { label: "Topping", ingredients: [] },
    ]
    const betweenNamed = moveIngredientToSection(namedOnly, 0, 0, 1)
    expect(betweenNamed[1].ingredients).toEqual([ingredient("butter")])

    const unsectioned = moveIngredientToSection(betweenNamed, 1, 0, null)
    expect(unsectioned).toEqual([
      { label: "Sauce", ingredients: [] },
      { label: "Topping", ingredients: [] },
      { label: null, ingredients: [ingredient("butter")] },
    ])
  })

  it("adds ingredients inside named and unsectioned sections", () => {
    expect(addIngredientToSection(sections, 0)[0].ingredients).toHaveLength(3)

    const noUnsectioned = [sections[0]]
    const withUnsectioned = addUnsectionedIngredient(noUnsectioned)
    expect(withUnsectioned).toEqual([
      sections[0],
      { label: null, ingredients: [{ item: "", amount: null, unit: "" }] },
    ])
  })

  it("creates, renames, and deletes only empty sections", () => {
    const created = addIngredientSection(sections)
    expect(created.at(-1)).toEqual({ label: "", ingredients: [] })

    const renamed = renameIngredientSection(created, 2, "Garnish")
    expect(renamed[2].label).toBe("Garnish")
    expect(removeEmptyIngredientSection(renamed, 2)).toEqual(sections)
    expect(removeEmptyIngredientSection(sections, 0)).toBe(sections)
  })

  it("reorders only within one section and supports deleting first, last, and all rows", () => {
    const reordered = reorderIngredientsWithinSection(sections, 0, 0, 1)
    expect(reordered[0].ingredients.map(({ item }) => item)).toEqual([
      "tomato",
      "pita",
    ])
    expect(reordered[1]).toEqual(sections[1])

    const withoutFirst = removeIngredientFromSection(reordered, 0, 0)
    const withoutLast = removeIngredientFromSection(withoutFirst, 0, 0)
    expect(withoutLast[0]).toEqual({ label: "For Serving", ingredients: [] })

    const removedAlternativeRow = removeIngredientFromSection(sections, 1, 1)
    const recreated = addIngredientToSection(removedAlternativeRow, 1)
    expect(recreated[1].ingredients.at(-1)).toEqual({
      item: "",
      amount: null,
      unit: "",
    })
  })

  it("preserves Shopping resolution across section-only edits", () => {
    const before = flattenRecipeIngredients(sections).map((value, sourceOrdinal) =>
      resolveShoppingIngredient({
        ingredient: value,
        recipeId: "recipe-a",
        sourceOrdinal,
      })
    )
    const moved = moveIngredientToSection(sections, 1, 0, 0)
    const after = flattenRecipeIngredients(moved).map((value, sourceOrdinal) =>
      resolveShoppingIngredient({
        ingredient: value,
        recipeId: "recipe-a",
        sourceOrdinal,
      })
    )

    expect(after).toEqual(before)
    const cilantro = after.find(({ purchaseKey }) => purchaseKey === "cilantro")
    expect(cilantro?.pantryMatchKeys).toContain("parsley")
  })
})
