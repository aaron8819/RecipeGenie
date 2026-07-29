import { describe, expect, it } from "vitest"
import {
  normalizeIngredients,
  normalizeRecipeShareSnapshot,
  normalizeShoppingItems,
  recipeShareSnapshotForDisplay,
  requireIngredientsForPersistence,
} from "@/lib/recipe-data-validation"
import { parseIngredientLine } from "@/lib/recipe-parser"

describe("structured recipe data boundaries", () => {
  it("preserves valid authored ingredient metadata through persistence", () => {
    const ingredient = parseIngredientLine("0.50 (14 oz) can tomatoes")
    expect(requireIngredientsForPersistence([ingredient])).toEqual([ingredient])
  })

  it("rejects malformed structured ingredient metadata on persistence", () => {
    const ingredient = parseIngredientLine("1 (14 oz) can tomatoes")
    expect(
      normalizeIngredients(
        [{ ...ingredient, quantityV1: { ...ingredient.quantityV1, authored: 1 } }],
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeIngredients([{ ...ingredient, packageV1: {} }], "persist")
    ).toBeNull()
    expect(normalizeIngredients([null], "persist")).toBeNull()
    expect(normalizeIngredients([true], "persist")).toBeNull()
  })

  it("hydrates historical malformed JSON without throwing or trusting it", () => {
    const ingredient = parseIngredientLine("1 cup milk")
    expect(
      normalizeIngredients([
        {
          ...ingredient,
          quantityV1: { version: 99, kind: "exact" },
          packageV1: [],
        },
      ])
    ).toEqual([
      {
        item: "milk",
        amount: 1,
        unit: "cup",
        authoredUnit: "cup",
        originalText: "1 cup milk",
      },
    ])
    expect(
      normalizeIngredients([
        {
          item: "milk",
          amount: 1,
          unit: "cup",
          authoredUnit: 123,
          originalText: false,
          alternatives: {},
        },
      ])
    ).toEqual([{ item: "milk", amount: 1, unit: "cup" }])
    expect(normalizeIngredients("legacy note")).toEqual([])
  })

  it("bounds and validates share snapshots at write and display boundaries", () => {
    const snapshot = {
      name: "Soup",
      category: "dinner",
      servings: 4,
      tags: ["easy"],
      ingredients: [parseIngredientLine("1 cup milk")],
      instructions: ["Stir"],
    }
    expect(normalizeRecipeShareSnapshot(snapshot, "persist")).toMatchObject({
      name: "Soup",
      category: "dinner",
      servings: 4,
      tags: ["easy"],
      ingredients: [
        {
          item: "milk",
          amount: 1,
          unit: "cup",
          originalText: "1 cup milk",
        },
      ],
      instructions: ["Stir"],
    })
    expect(
      normalizeRecipeShareSnapshot(
        {
          ...snapshot,
          yield_metadata: {
            version: 1,
            authoredText: 4,
            kind: "servings",
            scalingBasis: { numerator: "4", denominator: "1" },
          },
        },
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeRecipeShareSnapshot({
        ...snapshot,
        yield_metadata: [],
        prep_time_minutes: "soon",
        notes: false,
        instruction_groups: {},
      })
    ).toMatchObject({
      name: "Soup",
      ingredients: [{ item: "milk", amount: 1, unit: "cup" }],
      yield_metadata: null,
      prep_time_minutes: null,
      notes: [],
      instruction_groups: null,
    })
    expect(recipeShareSnapshotForDisplay({ malformed: true })).toMatchObject({
      name: "Shared recipe",
      ingredients: [],
      instructions: [],
    })
  })

  it("rejects malformed Shopping structured fields instead of spreading them", () => {
    const base = {
      item: "tomatoes",
      amount: null,
      unit: "can (14 oz)",
      categoryKey: "canned",
      categoryOrder: 1,
    }
    expect(
      normalizeShoppingItems(
        [{ ...base, exactPackageV1: {}, exactQuantityV1: [] }],
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeShoppingItems([
        {
          ...base,
          rowId: "tomatoes-row",
          contributionKey: "tomatoes",
          checked: false,
          exactPackageV1: {},
          exactQuantityV1: [],
          additionalAmounts: [{ amount: "many", unit: "can" }],
        },
      ])
    ).toEqual([
      {
        ...base,
        rowId: "tomatoes-row",
        contributionKey: "tomatoes",
        checked: false,
        sources: undefined,
      },
    ])
    expect(
      normalizeShoppingItems([
        {
          ...base,
          rowId: "tomatoes-row",
          exactAuthoredUnit: false,
          exactPackageV1: {},
          exactQuantityV1: [],
          structuredSourceKey: 123,
        },
      ])
    ).toEqual([
      {
        ...base,
        rowId: "tomatoes-row",
        sources: undefined,
      },
    ])
    expect(normalizeShoppingItems([null], "persist")).toBeNull()
  })
})
