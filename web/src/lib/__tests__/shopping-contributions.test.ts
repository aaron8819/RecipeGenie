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
  it("uses normalization version 2 for new frozen contribution snapshots", () => {
    expect(SHOPPING_NORMALIZATION_VERSION).toBe(2)
  })

  it("excludes a cross-contribution aggregate only for one unanimous built-in family", () => {
    const recipeA = contribution("a", 1)
    const recipeB = contribution("b", 2)
    for (const recipe of [recipeA, recipeB]) {
      recipe.items[0].item = "salt"
      recipe.items[0].bucket = "excluded"
      recipe.items[0].excludedBy = "Salt variants"
    }

    const result = project(list(), [], [recipeA, recipeB])

    expect(result.shoppingList.items).toEqual([])
    expect(result.shoppingList.excluded[0]).toMatchObject({
      amount: 3,
      excludedBy: "Salt variants",
    })
  })

  it("keeps mixed family, bucket, and exact-reason aggregates visible", () => {
    const family = contribution("a", 1)
    family.items[0].item = "salt"
    family.items[0].bucket = "excluded"
    family.items[0].excludedBy = "Salt variants"
    const visible = contribution("b", 2)
    visible.items[0].item = "salt"
    const otherFamily = contribution("c", 3)
    otherFamily.items[0].item = "salt"
    otherFamily.items[0].bucket = "excluded"
    otherFamily.items[0].excludedBy = "Black pepper variants"
    const exact = contribution("d", 4)
    exact.items[0].item = "salt"
    exact.items[0].bucket = "excluded"
    exact.items[0].excludedBy = "salt"

    for (const contributors of [
      [family, visible],
      [family, otherFamily],
      [family, exact],
    ]) {
      const result = project(list(), [], contributors)
      expect(result.shoppingList.excluded).toEqual([])
      expect(result.shoppingList.items).toHaveLength(1)
      expect(result.shoppingList.items[0].excludedBy).toBeUndefined()
    }
  })

  it("preserves a lifecycle bucket override over family unanimity", () => {
    const previous = contribution("a", 1)
    previous.items[0].item = "salt"
    previous.items[0].bucket = "excluded"
    previous.items[0].excludedBy = "Salt variants"
    const initial = project(list(), [], [previous])
    const restored = list({
      ...initial.shoppingList,
      items: [initial.shoppingList.excluded[0]],
      excluded: [],
    })
    const replacement = contribution("a", 2)
    replacement.items[0].item = "salt"
    replacement.items[0].bucket = "excluded"
    replacement.items[0].excludedBy = "Salt variants"

    const result = project(restored, [previous], [replacement])

    expect(result.shoppingList.items).toHaveLength(1)
    expect(result.shoppingList.excluded).toEqual([])
    expect(result.overrides.salt.bucket).toBe("items")
  })

  it("does not preserve a derived family bucket over new mixed evidence", () => {
    const family = contribution("a", 1)
    family.items[0].item = "salt"
    family.items[0].bucket = "excluded"
    family.items[0].excludedBy = "Salt variants"
    const initial = project(list(), [], [family])
    const unmatched = contribution("b", 2)
    unmatched.items[0].item = "salt"
    unmatched.items[0].sources = [{
      recipeId: "b",
      recipeName: unmatched.recipeName,
      originalItem: "salt",
      preparationModifiers: ["finely chopped"],
    }]

    const result = project(
      { ...list(), ...initial.shoppingList },
      [family],
      [family, unmatched]
    )

    expect(initial.shoppingList.excluded).toHaveLength(1)
    expect(result.shoppingList.excluded).toEqual([])
    expect(result.shoppingList.items[0]).toMatchObject({
      item: "salt",
      amount: 3,
    })
    expect(result.shoppingList.items[0].sources).toHaveLength(2)
    expect(result.overrides.salt.bucket).toBeUndefined()
  })

  it.each([
    ["Salt variants", "salt"],
    ["Black pepper variants", "black pepper"],
  ])(
    "keeps an exact %s exclusion out of family consensus",
    (reason, familyItem) => {
      const exact = contribution("a", 1)
      exact.items[0].item = reason
      exact.items[0].bucket = "excluded"
      exact.items[0].excludedBy = reason
      const sameKeyVisible = contribution("b", 2)
      sameKeyVisible.items[0].item = reason
      const family = contribution("c", 3)
      family.items[0].item = familyItem
      family.items[0].bucket = "excluded"
      family.items[0].excludedBy = reason
      const familyVisible = contribution("d", 4)
      familyVisible.items[0].item = familyItem

      const result = project(list(), [], [
        exact,
        sameKeyVisible,
        family,
        familyVisible,
      ])

      expect(result.shoppingList.excluded).toEqual([
        expect.objectContaining({
          item: reason.toLowerCase(),
          amount: 3,
        }),
      ])
      expect(result.shoppingList.items).toEqual([
        expect.objectContaining({ item: familyItem, amount: 7 }),
      ])
      expect(result.shoppingList.items[0].excludedBy).toBeUndefined()
    }
  )

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

  it("regression: merges singular and plural large eggs with both recipe sources", () => {
    const recipeA = contribution("a", 1)
    recipeA.items[0] = item("a", recipeA.recipeName, 1, {
      item: "large egg",
      unit: "count",
    })
    const recipeB = contribution("b", 2)
    recipeB.items[0] = item("b", recipeB.recipeName, 2, {
      item: "large eggs",
      unit: "count",
    })

    const result = project(list(), [], [recipeA, recipeB])

    expect(result.shoppingList.items).toEqual([
      expect.objectContaining({
        item: "large egg",
        amount: 3,
        unit: "count",
        contributionKey: "large egg",
        sources: [
          expect.objectContaining({ recipeId: "a" }),
          expect.objectContaining({ recipeId: "b" }),
        ],
      }),
    ])
  })

  it("upgrades version-1 identities in memory while preserving row and presentation overrides", () => {
    const frozenV1 = contribution("a", 1, { normalizationVersion: 1 })
    frozenV1.items[0] = item("a", frozenV1.recipeName, 1, {
      item: "large eggs",
      unit: "count",
    })
    const freshV2 = contribution("b", 2)
    freshV2.items[0] = item("b", freshV2.recipeName, 2, {
      item: "large egg",
      unit: "count",
    })
    const current = list({
      items: [{
        ...frozenV1.items[0],
        rowId: "derived:large eggs",
        contributionKey: "large eggs",
        checked: true,
        categoryKey: "custom_farm",
        categoryOrder: 9,
      }],
      source_recipes: ["a"],
      total_servings: 4,
    })

    const result = project(current, [frozenV1], [frozenV1, freshV2])

    expect(result.shoppingList.items).toEqual([
      expect.objectContaining({
        rowId: "derived:large eggs",
        contributionKey: "large egg",
        item: "large eggs",
        amount: 3,
        checked: true,
        categoryKey: "custom_farm",
        categoryOrder: 9,
      }),
    ])
    expect(frozenV1).toMatchObject({
      normalizationVersion: 1,
      items: [expect.objectContaining({ item: "large eggs" })],
    })
  })

  it("keeps a mixed version-1/version-2 projection idempotent", () => {
    const frozenV1 = contribution("a", 1, { normalizationVersion: 1 })
    frozenV1.items[0] = item("a", frozenV1.recipeName, 1, {
      item: "large eggs",
      unit: "count",
    })
    const freshV2 = contribution("b", 2)
    freshV2.items[0] = item("b", freshV2.recipeName, 2, {
      item: "large egg",
      unit: "count",
    })
    const contributions = [frozenV1, freshV2]
    const first = project(list(), [], contributions)
    const second = project(
      list({ ...first.shoppingList }),
      contributions,
      contributions,
      { existingOverrides: first.overrides }
    )
    const third = project(
      list({ ...second.shoppingList }),
      contributions,
      contributions,
      { existingOverrides: second.overrides }
    )

    expect(second.shoppingList).toEqual(first.shoppingList)
    expect(third.shoppingList).toEqual(second.shoppingList)
    expect(third.overrides).toEqual(second.overrides)
    expect(frozenV1.items[0].item).toBe("large eggs")
  })

  it("projects a version-1 collapsed category row without suppressing the newly split row", () => {
    const dairy = contribution("a", 1, { normalizationVersion: 1 })
    dairy.items[0] = item("a", dairy.recipeName, 1, {
      item: "eggs",
      unit: "count",
      categoryKey: "dairy",
    })
    const pantry = contribution("b", 2, { normalizationVersion: 1 })
    pantry.items[0] = item("b", pantry.recipeName, 2, {
      item: "egg",
      unit: "count",
      categoryKey: "pantry",
    })
    const current = list({
      items: [{
        ...pantry.items[0],
        amount: 3,
        rowId: "derived:eggs",
        contributionKey: "eggs",
        sources: [dairy.items[0].sources![0], pantry.items[0].sources![0]],
      }],
      source_recipes: ["a", "b"],
    })

    const result = project(current, [dairy, pantry], [dairy, pantry])

    expect(result.shoppingList.items).toHaveLength(2)
    expect(result.shoppingList.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contributionKey: "egg|category:pantry",
        rowId: "derived:eggs",
        categoryKey: "pantry",
      }),
      expect.objectContaining({
        contributionKey: "egg|category:dairy",
        rowId: "derived:egg|category:dairy",
        categoryKey: "dairy",
      }),
    ]))
  })

  it("applies an unsuffixed legacy override only to its matching category", () => {
    const dairy = contribution("a", 1)
    dairy.items[0] = item("a", dairy.recipeName, 1, {
      item: "egg",
      unit: "count",
      categoryKey: "dairy",
    })
    const pantry = contribution("b", 2)
    pantry.items[0] = item("b", pantry.recipeName, 2, {
      item: "eggs",
      unit: "count",
      categoryKey: "pantry",
    })

    const result = project(list(), [], [dairy, pantry], {
      existingOverrides: {
        eggs: {
          rowId: "legacy-dairy-egg",
          categoryKey: "dairy",
          categoryOrder: 5,
          checked: true,
        },
      },
    })

    expect(result.shoppingList.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contributionKey: "egg|category:dairy",
        rowId: "legacy-dairy-egg",
        checked: true,
      }),
      expect.objectContaining({
        contributionKey: "egg|category:pantry",
        rowId: "derived:egg|category:pantry",
      }),
    ]))
    expect(new Set(result.shoppingList.items.map((candidate) => candidate.rowId)).size).toBe(2)
  })

  it("preserves the surviving row when a category conflict collapses", () => {
    const dairy = contribution("a", 1)
    dairy.items[0] = item("a", dairy.recipeName, 1, {
      item: "egg",
      unit: "count",
      categoryKey: "dairy",
    })
    const pantry = contribution("b", 2)
    pantry.items[0] = item("b", pantry.recipeName, 2, {
      item: "eggs",
      unit: "count",
      categoryKey: "pantry",
    })
    const initial = project(list(), [], [dairy, pantry])
    const pantryRow = initial.shoppingList.items.find(
      (candidate) => candidate.categoryKey === "pantry"
    )!
    const current = list({
      ...initial.shoppingList,
      items: initial.shoppingList.items.map((candidate) =>
        candidate.rowId === pantryRow.rowId
          ? { ...candidate, checked: true }
          : candidate
      ),
    })

    const result = project(current, [dairy, pantry], [pantry])

    expect(result.shoppingList.items).toEqual([
      expect.objectContaining({
        contributionKey: "egg",
        rowId: pantryRow.rowId,
        checked: true,
        categoryKey: "pantry",
        amount: 2,
      }),
    ])
  })

  it("does not choose between ambiguous canonical legacy overrides", () => {
    const eggs = contribution("a", 1)
    eggs.items[0] = item("a", eggs.recipeName, 1, {
      item: "large egg",
      unit: "count",
    })

    const result = project(list(), [], [eggs], {
      existingOverrides: {
        "Large Egg": { rowId: "ambiguous-a", checked: true },
        "large eggs": { rowId: "ambiguous-b", checked: true },
      },
    })

    expect(result.shoppingList.items[0]).toMatchObject({
      rowId: "derived:large egg",
      checked: undefined,
    })
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
    expect(result.shoppingList.already_have[0].item).toBe("egg")
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
    expect(result.overrides.milk.bucket).toBeUndefined()
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
