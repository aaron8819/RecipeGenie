import { describe, expect, it } from "vitest"
import {
  isLegacyEmptyRecipeShareSnapshot,
  normalizeIngredients,
  normalizeRecipeShareSnapshot,
  normalizeShoppingItems,
  recipeShareSnapshotForDisplay,
  requireIngredientsForPersistence,
} from "@/lib/recipe-data-validation"
import { parseIngredientLine } from "@/lib/recipe-parser"

describe("structured recipe data boundaries", () => {
  it("recognizes only the supported legacy empty share snapshot", () => {
    expect(isLegacyEmptyRecipeShareSnapshot({})).toBe(true)
    expect(isLegacyEmptyRecipeShareSnapshot({ version: 0 })).toBe(false)
    expect(isLegacyEmptyRecipeShareSnapshot(null)).toBe(false)
    expect(isLegacyEmptyRecipeShareSnapshot([])).toBe(false)
    expect(isLegacyEmptyRecipeShareSnapshot("")).toBe(false)
    expect(isLegacyEmptyRecipeShareSnapshot(false)).toBe(false)
  })

  it("preserves valid authored ingredient metadata through persistence", () => {
    const ingredient = parseIngredientLine("0.50 (14 oz) can tomatoes")
    expect(requireIngredientsForPersistence([ingredient])).toEqual([ingredient])
  })

  it("rejects contradictory quantity and unit projections at persistence", () => {
    const ingredient = parseIngredientLine("0.50 cup sugar")
    expect(
      normalizeIngredients(
        [{ ...ingredient, amount: 9 }],
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeIngredients(
        [{ ...ingredient, unit: "tbsp" }],
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeIngredients(
        [{
          ...ingredient,
          quantityV1: {
            ...ingredient.quantityV1!,
            value: { numerator: "1", denominator: "2" },
            authored: "9",
          },
        }],
        "persist"
      )
    ).toBeNull()
  })

  it("uses bounded legacy data instead of contradictory hydrated metadata", () => {
    const ingredient = parseIngredientLine("1 cup sugar")
    expect(
      normalizeIngredients([{
        ...ingredient,
        amount: 9,
        originalText: "1 cup stale sugar",
      }])
    ).toEqual([
      {
        item: "sugar",
        amount: 9,
        unit: "cup",
        authoredUnit: "cup",
        originalText: "1 cup stale sugar",
      },
    ])
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

  it("enforces coherent Shopping quantity, unit, range, and package projections", () => {
    const exact = parseIngredientLine("1 cup sugar")
    const base = {
      item: "sugar",
      amount: 1,
      unit: "cup",
      categoryKey: "baking",
      categoryOrder: 1,
      exactQuantityV1: exact.quantityV1,
    }
    expect(
      normalizeShoppingItems(
        [{ ...base, exactAuthoredUnit: "lb" }],
        "persist"
      )
    ).toBeNull()
    expect(
      normalizeShoppingItems(
        [{ ...base, exactAuthoredUnit: "cups" }],
        "persist"
      )?.[0]
    ).toMatchObject({
      unit: "cup",
      exactAuthoredUnit: "cups",
      exactQuantityV1: { kind: "exact" },
    })
    expect(
      normalizeShoppingItems([{ ...base, exactAuthoredUnit: "lb" }])?.[0]
    ).not.toHaveProperty("exactQuantityV1")

    const range = parseIngredientLine("1–2 cups sugar")
    expect(
      normalizeShoppingItems(
        [{
          ...base,
          amount: null,
          exactQuantityV1: range.quantityV1,
          exactAuthoredUnit: "cups",
        }],
        "persist"
      )?.[0]
    ).toMatchObject({
      amount: null,
      exactQuantityV1: { kind: "range" },
    })
    expect(
      normalizeShoppingItems(
        [{
          ...base,
          exactQuantityV1: range.quantityV1,
          exactAuthoredUnit: "cups",
        }],
        "persist"
      )
    ).toBeNull()

    const packaged = parseIngredientLine("1 (14 oz) can tomatoes")
    expect(
      normalizeShoppingItems(
        [{
          item: "tomatoes",
          amount: 1,
          unit: "(14 oz) can",
          categoryKey: "canned",
          categoryOrder: 1,
          exactQuantityV1: packaged.quantityV1,
          exactPackageV1: packaged.packageV1,
          exactAuthoredUnit: "(14 oz) can",
        }],
        "persist"
      )?.[0]
    ).toHaveProperty("exactPackageV1")
    expect(
      normalizeShoppingItems(
        [{
          item: "tomatoes",
          amount: 1,
          unit: "cup",
          categoryKey: "canned",
          categoryOrder: 1,
          exactQuantityV1: packaged.quantityV1,
          exactPackageV1: packaged.packageV1,
          exactAuthoredUnit: "cup",
        }],
        "persist"
      )
    ).toBeNull()
  })
})
