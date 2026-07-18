import { describe, expect, it } from "vitest"
import {
  projectShoppingContributions,
  SHOPPING_NORMALIZATION_VERSION,
  type RecipeShoppingContribution,
} from "../shopping-contributions"
import type { ShoppingItem, ShoppingList } from "@/types/database"

function item(
  recipeId: string,
  recipeName: string,
  amount: number,
  overrides: Partial<ShoppingItem> = {}
) {
  return {
    item: "milk",
    amount,
    unit: "cup",
    categoryKey: "dairy",
    categoryOrder: 5,
    sources: [{ recipeId, recipeName }],
    bucket: "items" as const,
    ...overrides,
  }
}

function contribution(
  recipeId: string,
  amount: number,
  overrides: Partial<RecipeShoppingContribution> = {}
): RecipeShoppingContribution {
  const recipeName = `Recipe ${recipeId.toUpperCase()}`
  return {
    recipeId,
    recipeName,
    servings: 4,
    scale: 1,
    normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
    items: [item(recipeId, recipeName, amount)],
    ...overrides,
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
    generated_at: "2026-07-14T00:00:00.000Z",
    contribution_revision: 0,
    contribution_overrides: {},
    legacy_items_preserved: true,
    ...overrides,
  }
}

function project(
  currentList: ShoppingList,
  previousContributions: RecipeShoppingContribution[],
  nextContributions: RecipeShoppingContribution[],
  options: Partial<Parameters<typeof projectShoppingContributions>[0]> = {}
) {
  return projectShoppingContributions({
    ...options,
    currentList,
    previousContributions,
    nextContributions,
  })
}

describe("authoritative recipe shopping contributions", () => {
  it("projects one frozen recipe contribution", () => {
    const result = project(list(), [], [contribution("a", 1)])

    expect(result.shoppingList.items[0]).toMatchObject({
      item: "milk",
      amount: 1,
      unit: "cup",
      contributionKey: "milk",
    })
    expect(result.shoppingList.source_recipes).toEqual(["a"])
    expect(result.shoppingList.total_servings).toBe(4)
  })

  it("regression: adding the same recipe twice keeps one logical quantity", () => {
    const first = contribution("a", 1)
    const firstProjection = project(list(), [], [first]).shoppingList

    const result = project(
      { ...list(), ...firstProjection },
      [first],
      [first]
    )

    expect(result.shoppingList.items[0].amount).toBe(1)
    expect(result.shoppingList.items[0].sources).toHaveLength(1)
  })

  it("re-adding a recipe with changed servings replaces its quantity", () => {
    const previous = contribution("a", 1)
    const current = project(list(), [], [previous]).shoppingList
    const replacement = contribution("a", 2, { servings: 8, scale: 2 })

    const result = project(
      { ...list(), ...current },
      [previous],
      [replacement]
    )

    expect(result.shoppingList.items[0].amount).toBe(2)
    expect(result.shoppingList.total_servings).toBe(8)
  })

  it("replaces an edited ingredient without leaving its stale contribution", () => {
    const previous = contribution("a", 1)
    const current = project(list(), [], [previous]).shoppingList
    const replacement = contribution("a", 2)
    replacement.items = [
      item("a", replacement.recipeName, 2, {
        item: "oat milk",
      }),
    ]

    const result = project(
      { ...list(), ...current },
      [previous],
      [replacement]
    )

    expect(result.shoppingList.items).toEqual([
      expect.objectContaining({ item: "oat milk", amount: 2 }),
    ])
    expect(result.shoppingList.items.some((candidate) => candidate.item === "milk")).toBe(false)
  })

  it("removes a deleted ingredient and keeps the recipe's remaining contribution once", () => {
    const previous = contribution("a", 1)
    previous.items.push(
      item("a", previous.recipeName, 2, {
        item: "eggs",
        unit: "count",
      })
    )
    const current = project(list(), [], [previous]).shoppingList
    const replacement = contribution("a", 1)

    const result = project(
      { ...list(), ...current },
      [previous],
      [replacement]
    )

    expect(result.shoppingList.items).toHaveLength(1)
    expect(result.shoppingList.items[0]).toMatchObject({
      item: "milk",
      amount: 1,
    })
    expect(result.shoppingList.items[0].sources).toHaveLength(1)
    expect(result.shoppingList.items.some((candidate) => candidate.item === "eggs")).toBe(false)
  })

  it("sums two recipes sharing a normalized ingredient", () => {
    const result = project(
      list(),
      [],
      [contribution("a", 1), contribution("b", 2)]
    )

    expect(result.shoppingList.items[0].amount).toBe(3)
    expect(result.shoppingList.items[0].sources).toHaveLength(2)
  })

  it("regression: removing one shared recipe subtracts only its quantity", () => {
    const recipeA = contribution("a", 1)
    const recipeB = contribution("b", 2)
    const current = project(list(), [], [recipeA, recipeB]).shoppingList

    const result = project(
      { ...list(), ...current },
      [recipeA, recipeB],
      [recipeB]
    )

    expect(result.shoppingList.items[0].amount).toBe(2)
    expect(result.shoppingList.items[0].sources).toEqual([
      expect.objectContaining({ recipeId: "b" }),
    ])
  })

  it("removing the final recipe removes its derived aggregate", () => {
    const recipeA = contribution("a", 1)
    const current = project(list(), [], [recipeA]).shoppingList

    const result = project({ ...list(), ...current }, [recipeA], [])

    expect(result.shoppingList.items).toEqual([])
    expect(result.shoppingList.source_recipes).toEqual([])
  })

  it("merges convertible units and preserves non-convertible units", () => {
    const cups = contribution("a", 1)
    const fluidOunces = contribution("b", 8)
    fluidOunces.items[0].unit = "fl oz"
    const weight = contribution("c", 4)
    weight.items[0].unit = "oz"

    const result = project(list(), [], [cups, fluidOunces, weight])

    expect(result.shoppingList.items[0]).toMatchObject({
      amount: 2,
      unit: "cup",
      additionalAmounts: [{ amount: 4, unit: "oz" }],
    })
  })

  it("keeps alternatives, categories, pantry, and exclusions from frozen snapshots", () => {
    const recipeA = contribution("a", 1)
    recipeA.items = [
      item("a", recipeA.recipeName, 1, {
        item: "milk (or oat milk)",
        shoppingCategory: "dairy",
      }),
      { ...item("a", recipeA.recipeName, 2, { item: "eggs" }), bucket: "already_have" },
      {
        ...item("a", recipeA.recipeName, 1, { item: "salt", excludedBy: "salt" }),
        bucket: "excluded",
      },
    ]

    const result = project(list(), [], [recipeA])

    expect(result.shoppingList.items[0].item).toBe("milk (or oat milk)")
    expect(result.shoppingList.already_have[0].item).toBe("eggs")
    expect(result.shoppingList.excluded[0]).toMatchObject({
      item: "salt",
      excludedBy: "salt",
    })
  })

  it("preserves manual-only items when recipes are added and removed", () => {
    const manual: ShoppingItem = {
      item: "bananas",
      amount: 6,
      unit: "",
      categoryKey: "produce",
      categoryOrder: 1,
      sources: [{ recipeId: "", recipeName: "Manual" }],
      rowId: "manual-bananas",
    }
    const recipeA = contribution("a", 1)
    const added = project(list({ items: [manual] }), [], [recipeA])
    const removed = project(
      { ...list(), ...added.shoppingList },
      [recipeA],
      [],
      {
        currentList: { ...list(), ...added.shoppingList },
        previousContributions: [recipeA],
        nextContributions: [],
        existingOverrides: added.overrides,
      }
    )

    expect(added.shoppingList.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowId: "manual-bananas" })])
    )
    expect(removed.shoppingList.items).toEqual([manual])
  })

  it("preserves manual quantity, category, checked state, and lifecycle overrides", () => {
    const recipeA = contribution("a", 1)
    const initial = project(list(), [], [recipeA])
    const edited = {
      ...initial.shoppingList.items[0],
      amount: 3,
      categoryKey: "produce",
      categoryOrder: 1,
      checked: true,
    }
    const current = list({
      ...initial.shoppingList,
      items: [],
      already_have: [edited],
    })

    const result = project(current, [recipeA], [recipeA], {
      currentList: current,
      previousContributions: [recipeA],
      nextContributions: [recipeA],
      existingOverrides: initial.overrides,
    })

    expect(result.shoppingList.items).toEqual([])
    expect(result.shoppingList.already_have[0]).toMatchObject({
      amount: 3,
      categoryKey: "produce",
      checked: true,
    })
    expect(result.overrides.milk.quantity?.amount).toBe(3)
  })

  it("preserves a normal pantry move when the recipe contribution is replaced", () => {
    const previous = contribution("a", 1)
    const initial = project(list(), [], [previous])
    const pantryItem = initial.shoppingList.items[0]
    const afterPantryMove = list({
      ...initial.shoppingList,
      items: [],
      already_have: [pantryItem],
    })
    const replacement = contribution("a", 2, { servings: 8, scale: 2 })

    const result = project(afterPantryMove, [previous], [replacement])

    expect(result.shoppingList.items).toEqual([])
    expect(result.shoppingList.already_have[0]).toMatchObject({
      rowId: pantryItem.rowId,
      amount: 2,
    })
    expect(result.overrides.milk.bucket).toBe("already_have")
  })

  it("preserves generated exclusion and a later explicit restore across replacements", () => {
    const previous = contribution("a", 1)
    previous.items[0].bucket = "excluded"
    previous.items[0].excludedBy = "milk"
    const initial = project(list(), [], [previous])
    const excludedItem = initial.shoppingList.excluded[0]
    const replacement = contribution("a", 2, { servings: 8, scale: 2 })
    replacement.items[0].bucket = "excluded"
    replacement.items[0].excludedBy = "milk"

    const stillExcluded = project(
      list({ ...initial.shoppingList }),
      [previous],
      [replacement]
    )
    expect(stillExcluded.shoppingList.excluded[0].amount).toBe(2)

    const restoredList = list({
      ...stillExcluded.shoppingList,
      items: [stillExcluded.shoppingList.excluded[0]],
      excluded: [],
    })
    const afterRestore = project(restoredList, [replacement], [replacement], {
      existingOverrides: stillExcluded.overrides,
    })

    expect(afterRestore.shoppingList.excluded).toEqual([])
    expect(afterRestore.shoppingList.items).toHaveLength(1)
    expect(afterRestore.overrides.milk.bucket).toBe("items")
  })

  it("discards an invalid duplicate projection staging in favor of the active row", () => {
    const recipe = contribution("a", 1)
    const initial = project(list(), [], [recipe])
    const derivedItem = initial.shoppingList.items[0]
    const invalidProjection = list({
      ...initial.shoppingList,
      items: [derivedItem],
      already_have: [derivedItem],
    })

    const result = project(invalidProjection, [recipe], [recipe])

    expect(result.shoppingList.items).toHaveLength(1)
    expect(result.shoppingList.already_have).toEqual([])
    expect(result.overrides.milk.bucket).toBe("items")
  })

  it("keeps an explicit deletion suppressed while undo can restore the prior row", () => {
    const recipeA = contribution("a", 1)
    const initial = project(list(), [], [recipeA])
    const deletedList = list({ ...initial.shoppingList, items: [] })
    const deleted = project(deletedList, [recipeA], [recipeA])
    const restored = project(
      list({ ...initial.shoppingList }),
      [recipeA],
      [recipeA],
      {
        currentList: list({ ...initial.shoppingList }),
        previousContributions: [recipeA],
        nextContributions: [recipeA],
        existingOverrides: {},
      }
    )

    expect(deleted.shoppingList.items).toEqual([])
    expect(deleted.overrides.milk.deleted).toBe(true)
    expect(restored.shoppingList.items).toHaveLength(1)
  })

  it("preserves custom ordering and otherwise sorts deterministically", () => {
    const recipeA = contribution("a", 1)
    recipeA.items.push(item("a", recipeA.recipeName, 1, { item: "apple", unit: "" }))
    const first = project(list(), [], [recipeA]).shoppingList.items
    const second = project(list(), [], [recipeA]).shoppingList.items

    expect(first.map((candidate) => candidate.item)).toEqual(
      second.map((candidate) => candidate.item)
    )
    expect(first.map((candidate) => candidate.rowId)).toEqual(
      second.map((candidate) => candidate.rowId)
    )
    expect(recipeA.normalizationVersion).toBe(SHOPPING_NORMALIZATION_VERSION)
  })

  it("conservatively preserves ambiguous legacy rows but replaces confident single-recipe legacy rows", () => {
    const legacyMixed = item("a", "Recipe A", 9, {
      sources: [
        { recipeId: "a", recipeName: "Recipe A" },
        { recipeId: "b", recipeName: "Recipe B" },
      ],
    })
    const legacySingle = item("a", "Recipe A", 7)
    const recipeA = contribution("a", 1)

    const mixed = project(list({ items: [legacyMixed] }), [], [recipeA], {
      currentList: list({ items: [legacyMixed] }),
      previousContributions: [],
      nextContributions: [recipeA],
      replacingRecipeIds: ["a"],
    })
    const single = project(list({ items: [legacySingle] }), [], [recipeA], {
      currentList: list({ items: [legacySingle] }),
      previousContributions: [],
      nextContributions: [recipeA],
      replacingRecipeIds: ["a"],
    })

    expect(mixed.shoppingList.items).toHaveLength(2)
    expect(mixed.shoppingList.items[0].legacyRecipeProvenance).toBe(true)
    expect(single.shoppingList.items).toHaveLength(1)
    expect(single.shoppingList.items[0].amount).toBe(1)
  })
})
