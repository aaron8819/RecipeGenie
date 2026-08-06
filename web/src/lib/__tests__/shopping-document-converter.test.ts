import { describe, expect, it } from "vitest"
import type { PantryItem, ShoppingItem, ShoppingList } from "@/types/database"
import {
  SHOPPING_NORMALIZATION_VERSION,
  type RecipeShoppingContribution,
} from "../shopping-contributions"
import { convertShoppingPersistenceV1 } from "../shopping-document-converter"

function row(
  amount: number,
  sources: NonNullable<ShoppingItem["sources"]> = [],
  overrides: Partial<ShoppingItem> = {}
): ShoppingItem {
  return {
    item: "milk",
    amount,
    unit: "cup",
    categoryKey: "dairy",
    categoryOrder: 5,
    sources,
    ...overrides,
  }
}

function contribution(recipeId: string, amount: number): RecipeShoppingContribution {
  return {
    recipeId,
    recipeName: `Recipe ${recipeId}`,
    servings: 4,
    scale: 1,
    normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
    items: [{
      ...row(amount, [{ recipeId, recipeName: `Recipe ${recipeId}` }]),
      bucket: "items",
    }],
  }
}

function list(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    user_id: "user-a",
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1,
    total_servings: 0,
    custom_order: false,
    generated_at: "2026-08-01T00:00:00.000Z",
    contribution_revision: 3,
    ...overrides,
  }
}

describe("convertShoppingPersistenceV1", () => {
  it("reconstructs merged contribution intent, overrides, manual rows, preferences, and order", () => {
    const contributions = [contribution("a", 1), contribution("b", 2)]
    const current = list({
      items: [
        row(4, [
          { recipeId: "a", recipeName: "Recipe a" },
          { recipeId: "b", recipeName: "Recipe b" },
        ], { item: "edited milk", checked: true, categoryKey: "pantry" }),
        row(1, [{ recipeName: "Manual" }], {
          rowId: "manual-a",
          item: "paper towels",
          unit: "",
          categoryKey: "misc",
        }),
      ],
    })
    const original = structuredClone({ current, contributions })
    const result = convertShoppingPersistenceV1({
      currentList: current,
      contributions,
      preferences: {
        categoryOverrides: { milk: "dairy" },
        categoryOrder: ["produce", "dairy", "pantry", "misc"],
        excludeSaltVariants: true,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.state.document.recipeEntries)).toEqual(["a", "b"])
    expect(result.state.document.manualItems[0].id).toBe("manual-a")
    expect(result.state.document.order[1]).toBe("manual:manual-a")
    expect(Object.values(result.state.document.itemOverrides)[0]).toMatchObject({
      displayName: "edited milk",
      quantity: { amount: 4, unit: "cup" },
      categoryKey: "pantry",
      checked: true,
    })
    expect(result.state.document.preferences).toMatchObject({
      categoryByIngredient: { milk: "dairy" },
      excludeSaltVariants: true,
    })
    expect({ current, contributions }).toEqual(original)
  })

  it("preserves lifecycle bucket intent as an explicit override", () => {
    const recipe = contribution("a", 1)
    const result = convertShoppingPersistenceV1({
      currentList: list({
        already_have: [row(1, [{ recipeId: "a", recipeName: "Recipe a" }])],
      }),
      contributions: [recipe],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.values(result.state.document.itemOverrides)[0]).toMatchObject({
      bucket: "already_have",
    })
  })

  it("uses persisted contribution identity to disambiguate an edited row", () => {
    const recipe = contribution("a", 1)
    recipe.items.push({
      ...row(2, [{ recipeId: "a", recipeName: "Recipe a" }], {
        item: "eggs",
        unit: "count",
        categoryKey: "dairy",
      }),
      bucket: "items",
    })
    const result = convertShoppingPersistenceV1({
      currentList: list({
        items: [
          row(1, [{ recipeId: "a", recipeName: "Recipe a" }], {
            item: "edited milk",
            contributionKey: "milk",
          }),
          row(2, [{ recipeId: "a", recipeName: "Recipe a" }], {
            item: "eggs",
            unit: "count",
          }),
        ],
      }),
      contributions: [recipe],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.values(result.state.document.itemOverrides)[0]).toMatchObject({
      displayName: "edited milk",
    })
  })

  it("does not freeze a current Pantry classification when Pantry explains it", () => {
    const recipe = contribution("a", 1)
    const result = convertShoppingPersistenceV1({
      currentList: list({
        already_have: [row(1, [{ recipeId: "a", recipeName: "Recipe a" }])],
      }),
      contributions: [recipe],
      pantryItems: [{ item: "milk" } as PantryItem],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.document.itemOverrides).toEqual({})
  })

  it("fails closed for ambiguous mixed provenance", () => {
    const result = convertShoppingPersistenceV1({
      currentList: list({
        items: [row(1, [
          { recipeId: "a", recipeName: "Recipe a" },
          { recipeId: "unknown", recipeName: "Unknown" },
        ])],
      }),
      contributions: [contribution("a", 1)],
    })
    expect(result).toMatchObject({ ok: false, issues: [{ code: "ambiguous-row" }] })
  })

  it("fails closed for malformed current persistence", () => {
    const malformed = list() as any
    malformed.items = null
    expect(convertShoppingPersistenceV1({
      currentList: malformed,
      contributions: [],
    })).toMatchObject({ ok: false, issues: [{ code: "malformed" }] })
  })
})
