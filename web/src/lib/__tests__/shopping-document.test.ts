import { describe, expect, it } from "vitest"
import type { PantryItem } from "@/types/database"
import { canonicalizeRecipeFixture } from "@/test/recipe-fixtures"
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  projectShoppingDocument,
  upgradeShoppingDocumentV1,
  validateShoppingDocumentStateV2,
  validateShoppingDocumentV2,
  type ShoppingDocumentStateV2,
  type ShoppingDocumentV1,
  type ShoppingDocumentV2,
  type ShoppingRecipeEntryV1,
} from "../shopping-document"
import { resolveShoppingIngredient } from "../shopping-ingredient-resolution"

function entry(
  recipeId: string,
  item: string,
  amount = 1,
  overrides: { modifier?: string; unit?: string } = {}
): ShoppingRecipeEntryV1 {
  const resolved = resolveShoppingIngredient({
    ingredient: {
      item,
      amount,
      unit: overrides.unit || "count",
      modifier: overrides.modifier,
    },
    recipeId,
    exactScaleV1: { numerator: "1", denominator: "1" },
  })
  return {
    recipeId,
    recipeName: `Recipe ${recipeId}`,
    selectedServings: 4,
    scaleV1: { numerator: "1", denominator: "1" },
    ingredients: [{
      ingredientKey: resolved.ingredientKey,
      aggregateKey: resolved.aggregateKey,
      displayName: resolved.displayName,
      quantity: resolved.quantity,
      purchaseUnit: resolved.purchaseUnit,
      defaultCategoryKey: resolved.defaultCategoryKey,
      pantryMatchKeys: resolved.pantryMatchKeys,
      exclusionFamily: resolved.exclusionFamily,
      citrusPrep: resolved.citrusPrep,
    }],
  }
}

function populated(): ShoppingDocumentV2 {
  const document = createEmptyShoppingDocument()
  document.recipeEntries.a = entry("a", "apple", 1)
  document.manualItems.push({
    id: "manual-a",
    displayName: "paper towels",
    quantity: null,
    categoryKey: "misc",
    bucket: "items",
    checked: false,
  })
  const key = document.recipeEntries.a.ingredients[0].aggregateKey
  document.itemOverrides[key] = { checked: true }
  document.preferences.ingredientOrderByCategory = {
    produce: [document.recipeEntries.a.ingredients[0].ingredientKey],
    misc: ["paper towels"],
  }
  return document
}

describe("ShoppingDocumentV2 validation", () => {
  it("accepts exact empty and populated documents", () => {
    expect(validateShoppingDocumentV2(createEmptyShoppingDocument()).ok).toBe(true)
    expect(validateShoppingDocumentV2(populated()).ok).toBe(true)
  })

  it.each([
    ["wrong version", (value: any) => { value.schemaVersion = 1 }],
    ["duplicate recipe identity", (value: any) => { value.recipeEntries.other = { ...value.recipeEntries.a } }],
    ["duplicate manual identity", (value: any) => { value.manualItems.push({ ...value.manualItems[0] }) }],
    ["malformed override", (value: any) => { value.itemOverrides[Object.keys(value.itemOverrides)[0]] = { checked: "yes" } }],
    ["legacy row order", (value: any) => { value.order = ["manual:manual-a"] }],
    ["duplicate learned identity", (value: any) => {
      value.preferences.ingredientOrderByCategory.misc.push("apple")
    }],
    ["persisted projection", (value: any) => { value.items = [] }],
  ])("rejects %s", (_label, mutate) => {
    const value = populated() as any
    mutate(value)
    expect(validateShoppingDocumentV2(value).ok).toBe(false)
  })

  it("validates the external CAS revision", () => {
    expect(validateShoppingDocumentStateV2({
      document: createEmptyShoppingDocument(),
      contentRevision: -1,
    }).ok).toBe(false)
  })

  it("persists generated recipe entries without projection metadata", () => {
    const recipe = canonicalizeRecipeFixture({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Scaled Pepper",
      servings: 4,
      fixtureIngredients: [
        { item: "black pepper", amount: 1, unit: "teaspoon" },
        {
          item: "yogurt",
          amount: 1,
          unit: "cup",
          alternatives: ["sour cream"],
        },
      ],
    })
    const document = createEmptyShoppingDocument()
    document.recipeEntries[recipe.id] = entry(recipe.id, "milk", 1, {
      unit: "cup",
    })
    document.recipeEntries.other = entry("other", "garlic")
    const replacedKey = document.recipeEntries[recipe.id].ingredients[0]
      .aggregateKey
    document.itemOverrides[replacedKey] = { checked: true }
    expect(validateShoppingDocumentV2(document).ok).toBe(true)

    const runtimeIngredient = resolveShoppingIngredient({
      ingredient: recipe.ingredientSections[0].ingredients[0],
      recipeId: recipe.id,
    })
    const persistedEntry = createShoppingRecipeEntry(
      recipe,
      8,
      { numerator: "2", denominator: "1" }
    )
    const next = applyShoppingDocumentMutation(
      { document, contentRevision: 3 },
      { type: "upsertRecipe", entry: persistedEntry }
    )
    const persistedIngredient = next.document.recipeEntries[recipe.id]
      .ingredients[0]
    const pantryIngredient = next.document.recipeEntries[recipe.id]
      .ingredients[1]

    expect(runtimeIngredient.defaultCategoryOrder).toBeTypeOf("number")
    expect(persistedEntry.ingredients.every((ingredient) =>
      !("defaultCategoryOrder" in ingredient))).toBe(true)
    expect(validateShoppingDocumentV2(next.document).ok).toBe(true)
    expect(next.contentRevision).toBe(4)
    expect(next.document.recipeEntries.other).toBe(document.recipeEntries.other)
    expect(next.document.itemOverrides).toEqual({})
    expect(next.document.recipeEntries[recipe.id]).toMatchObject({
      recipeName: "Scaled Pepper",
      selectedServings: 8,
      scaleV1: { numerator: "2", denominator: "1" },
    })
    expect(persistedIngredient).toMatchObject({
      quantity: { amount: 2, unit: "tsp" },
      pantryMatchKeys: ["black pepper"],
      exclusionFamily: "black-pepper",
    })
    expect(pantryIngredient).toMatchObject({
      quantity: { amount: 2, unit: "cup" },
      pantryMatchKeys: ["yogurt", "sour cream"],
    })
  })
})

describe("Shopping document projection", () => {
  it("aggregates equivalent inputs deterministically and retains recipe provenance", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.b = entry("b", "apples", 2)
    document.recipeEntries.a = entry("a", "apple", 1)
    const original = structuredClone(document)

    const first = projectShoppingDocument(document)
    const second = projectShoppingDocument(document)

    expect(first).toEqual(second)
    expect(first.rows).toHaveLength(1)
    expect(first.rows[0].quantity?.amount).toBe(3)
    expect(first.rows[0].sources.map((source) => source.recipeId)).toEqual(["a", "b"])
    expect(document).toEqual(original)
  })

  it("keeps non-equivalent ingredients separate", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple", 1)
    document.recipeEntries.b = entry("b", "granny smith apple", 1)
    expect(projectShoppingDocument(document).rows).toHaveLength(2)
  })

  it("uses the same conservative ordering identity for manual and recipe rows", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apples", 2)
    document.manualItems.push({
      id: "manual-apple",
      displayName: "apple",
      quantity: null,
      categoryKey: "produce",
      bucket: "items",
      checked: false,
    })
    document.preferences.ingredientOrderByCategory = { produce: ["apple"] }

    const rows = projectShoppingDocument(document).rows
    expect(rows.map((row) => row.orderingKey)).toEqual(["apple", "apple"])
    expect(rows.map((row) => row.rowRef)).toEqual([
      expect.stringMatching(/^derived:/),
      "manual:manual-apple",
    ])
  })

  it("does not double-count one recipe's overlapping citrus prep", () => {
    const document = createEmptyShoppingDocument()
    const citrus = (item: string) => {
      const resolved = resolveShoppingIngredient({
        ingredient: { item, amount: 1, unit: "count" },
        recipeId: "a",
      })
      return {
        ingredientKey: resolved.ingredientKey,
        aggregateKey: resolved.aggregateKey,
        displayName: resolved.displayName,
        quantity: resolved.quantity,
        purchaseUnit: resolved.purchaseUnit,
        defaultCategoryKey: resolved.defaultCategoryKey,
        pantryMatchKeys: resolved.pantryMatchKeys,
        citrusPrep: resolved.citrusPrep,
      }
    }
    document.recipeEntries.a = {
      recipeId: "a",
      recipeName: "Recipe a",
      selectedServings: 4,
      scaleV1: { numerator: "1", denominator: "1" },
      ingredients: [citrus("lemon, juiced"), citrus("lemon, zested")],
    }
    expect(projectShoppingDocument(document).rows[0].quantity?.amount).toBe(1)
  })

  it("reprojects replacement recipe quantities at a new scale", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "milk", 1, { unit: "cup" })
    const initialKey = document.recipeEntries.a.ingredients[0].aggregateKey
    const replacement = entry("a", "milk", 2, { unit: "cup" })
    document.recipeEntries.a = replacement
    expect(replacement.ingredients[0].aggregateKey).toBe(initialKey)
    expect(projectShoppingDocument(document).rows[0].quantity?.amount).toBe(2)
  })

  it("applies derived overrides, ingredient preferences, and manual rows", () => {
    const document = populated()
    const key = document.recipeEntries.a.ingredients[0].aggregateKey
    document.itemOverrides[key] = {
      displayName: "edited apples",
      quantity: null,
      bucket: "excluded",
      checked: true,
    }
    document.preferences.categoryByIngredient.apple = "dairy"
    const projection = projectShoppingDocument(document)

    expect(projection.rows.map((row) => row.rowRef)).toEqual([
      `derived:${key}`,
      "manual:manual-a",
    ])
    expect(projection.rows[0]).toMatchObject({
      displayName: "edited apples",
      quantity: null,
      categoryKey: "dairy",
      bucket: "excluded",
      checked: true,
    })
  })

  it("reclassifies live Pantry and exclusion inputs without mutating the document", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "kosher salt", 1, { unit: "tsp" })
    const original = structuredClone(document)
    expect(projectShoppingDocument(document).items).toHaveLength(1)
    expect(projectShoppingDocument(document, [{ item: "kosher salt" } as PantryItem]).alreadyHave).toHaveLength(1)
    document.preferences.excludeSaltVariants = true
    expect(projectShoppingDocument(document).excluded[0].excludedBy).toBe("Salt variants")
    document.preferences.excludeSaltVariants = false
    expect(document).toEqual(original)
  })

  it("keeps bare pepper visible under black-pepper exclusion", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "pepper", 1, { unit: "tsp" })
    document.preferences.excludeBlackPepperVariants = true
    expect(projectShoppingDocument(document).items).toHaveLength(1)
  })
})

describe("Shopping document reducers", () => {
  it("supports recipe replacement/removal and prunes orphan intent", () => {
    let state: ShoppingDocumentStateV2 = { document: createEmptyShoppingDocument(), contentRevision: 0 }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipe", entry: entry("a", "apple") })
    const key = state.document.recipeEntries.a.ingredients[0].aggregateKey
    state = applyShoppingDocumentMutation(state, { type: "setChecked", rowRef: `derived:${key}`, checked: true })
    state = applyShoppingDocumentMutation(state, { type: "rescaleRecipe", entry: entry("a", "milk", 2, { unit: "cup" }) })
    expect(Object.keys(state.document.recipeEntries)).toEqual(["a"])
    expect(state.document.itemOverrides).toEqual({})
    state = applyShoppingDocumentMutation(state, { type: "removeRecipe", recipeId: "a" })
    expect(state.document.recipeEntries).toEqual({})
  })

  it("supports explicit overrides, ingredient preference, and the manual lifecycle", () => {
    let state: ShoppingDocumentStateV2 = { document: createEmptyShoppingDocument(), contentRevision: 4 }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipe", entry: entry("a", "apple") })
    const key = state.document.recipeEntries.a.ingredients[0].aggregateKey
    const mutations = [
      { type: "setQuantityOverride", aggregateKey: key, quantity: null },
      { type: "setDisplayNameOverride", aggregateKey: key, displayName: "apples" },
      { type: "setIngredientCategory", ingredientKey: "apple", categoryKey: "produce" },
      { type: "addManualItem", item: { id: "m", displayName: "foil", quantity: null, categoryKey: "misc", bucket: "items", checked: false } },
    ] as const
    for (const mutation of mutations) state = applyShoppingDocumentMutation(state, mutation)
    state = applyShoppingDocumentMutation(state, {
      type: "editManualItem",
      id: "m",
      changes: { displayName: "foil roll" },
    })
    state = applyShoppingDocumentMutation(state, {
      type: "setChecked",
      rowRef: "manual:m",
      checked: true,
    })
    expect(state.document.manualItems[0].displayName).toBe("foil roll")
    expect(state.document.manualItems[0].checked).toBe(true)
    state = applyShoppingDocumentMutation(state, { type: "deleteManualItem", id: "m" })
    expect(state.document.manualItems).toEqual([])
  })

  it("learns a cross-category position and reusable category in one mutation", () => {
    let state: ShoppingDocumentStateV2 = {
      document: createEmptyShoppingDocument(),
      contentRevision: 2,
    }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipes", entries: [
      entry("a", "apple"),
      entry("b", "milk", 1, { unit: "cup" }),
    ] })
    const rows = projectShoppingDocument(state.document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const milk = rows.find((row) => row.orderingKey === "milk")!
    state = applyShoppingDocumentMutation(state, {
      type: "learnOrder",
      draggedRowRef: apple.rowRef,
      draggedOrderingKey: apple.orderingKey,
      sourceCategoryKey: apple.categoryKey,
      targetRowRef: milk.rowRef,
      targetOrderingKey: milk.orderingKey,
      targetCategoryKey: milk.categoryKey,
      placement: "after",
    })
    expect(state.document.preferences.categoryByIngredient.apple).toBe("dairy")
    expect(state.document.preferences.ingredientOrderByCategory).toEqual({
      dairy: ["milk", "apple"],
    })
    expect(state.document.itemOverrides).toEqual({})
    expect(state.contentRevision).toBe(4)
  })

  it("fails closed when a drag target is removed before CAS replay", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.recipeEntries.b = entry("b", "banana")
    const rows = projectShoppingDocument(document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const banana = rows.find((row) => row.orderingKey === "banana")!
    delete document.recipeEntries.b
    const fresh = { document, contentRevision: 9 }

    const replayed = applyShoppingDocumentMutation(fresh, {
      type: "learnOrder",
      draggedRowRef: apple.rowRef,
      draggedOrderingKey: apple.orderingKey,
      sourceCategoryKey: apple.categoryKey,
      targetRowRef: banana.rowRef,
      targetOrderingKey: banana.orderingKey,
      targetCategoryKey: banana.categoryKey,
      placement: "after",
    })

    expect(replayed).toBe(fresh)
  })

  it("fails closed when a drag target changes category before CAS replay", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.recipeEntries.b = entry("b", "banana")
    const rows = projectShoppingDocument(document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const banana = rows.find((row) => row.orderingKey === "banana")!
    document.preferences.categoryByIngredient.banana = "dairy"
    const fresh = { document, contentRevision: 9 }

    const replayed = applyShoppingDocumentMutation(fresh, {
      type: "learnOrder",
      draggedRowRef: apple.rowRef,
      draggedOrderingKey: apple.orderingKey,
      sourceCategoryKey: apple.categoryKey,
      targetRowRef: banana.rowRef,
      targetOrderingKey: banana.orderingKey,
      targetCategoryKey: banana.categoryKey,
      placement: "after",
    })

    expect(replayed).toBe(fresh)
  })

  it("fails closed when the dragged row is removed before CAS replay", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.recipeEntries.b = entry("b", "banana")
    const rows = projectShoppingDocument(document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const banana = rows.find((row) => row.orderingKey === "banana")!
    delete document.recipeEntries.a
    const fresh = { document, contentRevision: 9 }

    const replayed = applyShoppingDocumentMutation(fresh, {
      type: "learnOrder",
      draggedRowRef: apple.rowRef,
      draggedOrderingKey: apple.orderingKey,
      sourceCategoryKey: apple.categoryKey,
      targetRowRef: banana.rowRef,
      targetOrderingKey: banana.orderingKey,
      targetCategoryKey: banana.categoryKey,
      placement: "after",
    })

    expect(replayed).toBe(fresh)
  })

  it("replays a drag against fresh ordering after an unrelated mutation", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.recipeEntries.b = entry("b", "banana")
    const rows = projectShoppingDocument(document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const banana = rows.find((row) => row.orderingKey === "banana")!
    document.manualItems.push({
      id: "concurrent",
      displayName: "foil",
      quantity: null,
      categoryKey: "misc",
      bucket: "items",
      checked: true,
    })

    const replayed = applyShoppingDocumentMutation(
      { document, contentRevision: 9 },
      {
        type: "learnOrder",
        draggedRowRef: banana.rowRef,
        draggedOrderingKey: banana.orderingKey,
        sourceCategoryKey: banana.categoryKey,
        targetRowRef: apple.rowRef,
        targetOrderingKey: apple.orderingKey,
        targetCategoryKey: apple.categoryKey,
        placement: "before",
      }
    )

    expect(replayed.contentRevision).toBe(10)
    expect(replayed.document.manualItems[0].checked).toBe(true)
    expect(replayed.document.preferences.ingredientOrderByCategory.produce)
      .toEqual(["banana", "apple"])
  })

  it("resets learned category and order authority atomically", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.preferences.categoryByIngredient.apple = "dairy"
    document.preferences.ingredientOrderByCategory = {
      dairy: ["hidden-dairy", "apple"],
      produce: ["hidden-produce"],
    }

    const reset = applyShoppingDocumentMutation(
      { document, contentRevision: 4 },
      {
        type: "updateCategoryPreferences",
        preferences: { categoryByIngredient: {} },
      }
    )

    expect(projectShoppingDocument(reset.document).rows[0].categoryKey)
      .toBe("produce")
    expect(reset.document.preferences.ingredientOrderByCategory).toEqual({
      dairy: ["hidden-dairy"],
      produce: ["hidden-produce", "apple"],
    })
  })

  it("deletes a custom category across derived and hidden order authority", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.manualItems.push({
      id: "paper",
      displayName: "paper towels",
      quantity: null,
      categoryKey: "misc",
      bucket: "items",
      checked: false,
    })
    document.preferences.customCategories = [
      { id: "bulk", name: "Bulk", order: 9 },
    ]
    document.preferences.categoryOrder = ["custom_bulk", "misc"]
    document.preferences.categoryByIngredient.apple = "custom_bulk"
    document.preferences.ingredientOrderByCategory = {
      custom_bulk: ["hidden-bulk", "apple"],
      misc: ["paper towels"],
    }

    let state = applyShoppingDocumentMutation(
      { document, contentRevision: 5 },
      {
        type: "updateCategoryPreferences",
        preferences: {
          customCategories: [],
          categoryOrder: ["misc"],
          categoryByIngredient: document.preferences.categoryByIngredient,
        },
      }
    )

    expect(state.document.preferences.categoryByIngredient.apple).toBe("misc")
    expect(state.document.preferences.categoryOrder).toEqual(["misc"])
    expect(state.document.preferences.ingredientOrderByCategory.custom_bulk)
      .toBeUndefined()
    expect(state.document.preferences.ingredientOrderByCategory.misc).toEqual([
      "paper towels",
      "hidden-bulk",
      "apple",
    ])

    const rows = projectShoppingDocument(state.document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const paper = rows.find((row) => row.orderingKey === "paper towels")!
    state = applyShoppingDocumentMutation(state, {
      type: "learnOrder",
      draggedRowRef: apple.rowRef,
      draggedOrderingKey: apple.orderingKey,
      sourceCategoryKey: apple.categoryKey,
      targetRowRef: paper.rowRef,
      targetOrderingKey: paper.orderingKey,
      targetCategoryKey: paper.categoryKey,
      placement: "before",
    })
    expect(state.document.preferences.ingredientOrderByCategory.misc).toEqual([
      "apple",
      "paper towels",
      "hidden-bulk",
    ])
  })

  it("transfers a hidden mapped identity when deleting its custom category", () => {
    const document = createEmptyShoppingDocument()
    document.preferences.customCategories = [
      { id: "bulk", name: "Bulk", order: 9 },
    ]
    document.preferences.categoryByIngredient["hidden-flour"] = "custom_bulk"
    document.preferences.ingredientOrderByCategory = {
      custom_bulk: ["hidden-flour"],
    }

    const deleted = applyShoppingDocumentMutation(
      { document, contentRevision: 2 },
      {
        type: "updateCategoryPreferences",
        preferences: {
          customCategories: [],
          categoryOrder: [],
          categoryByIngredient: { "hidden-flour": "misc" },
        },
      }
    )

    expect(deleted.document.preferences.categoryByIngredient["hidden-flour"])
      .toBe("misc")
    expect(deleted.document.preferences.ingredientOrderByCategory).toEqual({
      misc: ["hidden-flour"],
    })
  })

  it("preserves transferred order with existing, visible, and hidden keys", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.flour = entry("flour", "flour")
    document.manualItems.push(
      {
        id: "paper",
        displayName: "paper towels",
        quantity: null,
        categoryKey: "misc",
        bucket: "items",
        checked: false,
      },
      {
        id: "batteries",
        displayName: "batteries",
        quantity: null,
        categoryKey: "misc",
        bucket: "items",
        checked: false,
      }
    )
    document.preferences.customCategories = [
      { id: "bulk", name: "Bulk", order: 9 },
    ]
    document.preferences.categoryByIngredient = {
      flour: "custom_bulk",
      sugar: "custom_bulk",
      yeast: "custom_bulk",
    }
    document.preferences.ingredientOrderByCategory = {
      misc: ["paper towels", "batteries"],
      custom_bulk: ["flour", "sugar", "yeast"],
    }

    let state = applyShoppingDocumentMutation(
      { document, contentRevision: 2 },
      {
        type: "updateCategoryPreferences",
        preferences: {
          customCategories: [],
          categoryOrder: [],
          categoryByIngredient: {
            flour: "misc",
            sugar: "misc",
            yeast: "misc",
          },
        },
      }
    )

    expect(state.document.preferences.categoryByIngredient).toEqual({
      flour: "misc",
      sugar: "misc",
      yeast: "misc",
    })
    expect(state.document.preferences.ingredientOrderByCategory).toEqual({
      misc: ["paper towels", "batteries", "flour", "sugar", "yeast"],
    })

    const rows = projectShoppingDocument(state.document).rows
    const flour = rows.find((row) => row.orderingKey === "flour")!
    const paper = rows.find((row) => row.orderingKey === "paper towels")!
    state = applyShoppingDocumentMutation(state, {
      type: "learnOrder",
      draggedRowRef: flour.rowRef,
      draggedOrderingKey: flour.orderingKey,
      sourceCategoryKey: flour.categoryKey,
      targetRowRef: paper.rowRef,
      targetOrderingKey: paper.orderingKey,
      targetCategoryKey: paper.categoryKey,
      placement: "before",
    })
    expect(state.document.preferences.ingredientOrderByCategory.misc).toEqual([
      "flour",
      "paper towels",
      "batteries",
      "sugar",
      "yeast",
    ])
  })

  it("moves manual rows out of a deleted custom category", () => {
    const document = createEmptyShoppingDocument()
    document.manualItems.push({
      id: "manual-flour",
      displayName: "flour",
      quantity: null,
      categoryKey: "custom_bulk",
      bucket: "items",
      checked: false,
    })
    document.preferences.customCategories = [
      { id: "bulk", name: "Bulk", order: 9 },
    ]
    document.preferences.categoryOrder = ["custom_bulk"]
    document.preferences.ingredientOrderByCategory = {
      custom_bulk: ["flour", "hidden-bulk"],
    }

    const deleted = applyShoppingDocumentMutation(
      { document, contentRevision: 2 },
      {
        type: "updateCategoryPreferences",
        preferences: { customCategories: [], categoryOrder: [] },
      }
    )

    expect(deleted.document.manualItems[0].categoryKey).toBe("misc")
    expect(deleted.document.preferences.ingredientOrderByCategory).toEqual({
      misc: ["flour", "hidden-bulk"],
    })
    expect(projectShoppingDocument(deleted.document).rows[0].categoryKey)
      .toBe("misc")
  })

  it("rejects same-identity drops without partial category mutation", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.manualItems.push({
      id: "manual-apple",
      displayName: "apples",
      quantity: null,
      categoryKey: "dairy",
      bucket: "items",
      checked: false,
    })
    document.preferences.ingredientOrderByCategory = { produce: ["apple"] }
    const rows = projectShoppingDocument(document).rows
    const derived = rows.find((row) => row.rowRef.startsWith("derived:"))!
    const manual = rows.find((row) => row.rowRef === "manual:manual-apple")!
    const fresh = { document, contentRevision: 7 }

    const result = applyShoppingDocumentMutation(fresh, {
      type: "learnOrder",
      draggedRowRef: derived.rowRef,
      draggedOrderingKey: derived.orderingKey,
      sourceCategoryKey: derived.categoryKey,
      targetRowRef: manual.rowRef,
      targetOrderingKey: manual.orderingKey,
      targetCategoryKey: manual.categoryKey,
      placement: "after",
    })

    expect(result).toBe(fresh)
    expect(result.document.preferences.categoryByIngredient).toEqual({})
    expect(result.document.manualItems[0].categoryKey).toBe("dairy")
  })

  it("treats a same-category same-identity drop as a complete no-op", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "apple")
    document.manualItems.push({
      id: "manual-apple",
      displayName: "apples",
      quantity: null,
      categoryKey: "produce",
      bucket: "items",
      checked: false,
    })
    const rows = projectShoppingDocument(document).rows
    const derived = rows.find((row) => row.rowRef.startsWith("derived:"))!
    const manual = rows.find((row) => row.rowRef === "manual:manual-apple")!
    const fresh = { document, contentRevision: 7 }

    expect(applyShoppingDocumentMutation(fresh, {
      type: "learnOrder",
      draggedRowRef: derived.rowRef,
      draggedOrderingKey: derived.orderingKey,
      sourceCategoryKey: derived.categoryKey,
      targetRowRef: manual.rowRef,
      targetOrderingKey: manual.orderingKey,
      targetCategoryKey: manual.categoryKey,
      placement: "after",
    })).toBe(fresh)
  })

  it("keeps learned order through regeneration, visibility changes, clear, and rebuild", () => {
    let state: ShoppingDocumentStateV2 = {
      document: createEmptyShoppingDocument(),
      contentRevision: 0,
    }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipes", entries: [
      entry("a", "apple"),
      entry("b", "banana"),
    ] })
    const rows = projectShoppingDocument(state.document).rows
    const apple = rows.find((row) => row.orderingKey === "apple")!
    const banana = rows.find((row) => row.orderingKey === "banana")!
    state = applyShoppingDocumentMutation(state, {
      type: "learnOrder",
      draggedRowRef: banana.rowRef,
      draggedOrderingKey: "banana",
      sourceCategoryKey: "produce",
      targetRowRef: apple.rowRef,
      targetOrderingKey: "apple",
      targetCategoryKey: "produce",
      placement: "before",
    })
    state = applyShoppingDocumentMutation(state, {
      type: "upsertRecipe",
      entry: entry("c", "carrot"),
    })
    state = applyShoppingDocumentMutation(state, {
      type: "rescaleRecipe",
      entry: entry("a", "apple", 4),
    })
    expect(projectShoppingDocument(state.document).rows.map((row) => row.orderingKey))
      .toEqual(["banana", "apple", "carrot"])
    expect(projectShoppingDocument(
      state.document,
      [{ item: "banana" } as PantryItem]
    ).alreadyHave[0].orderingKey).toBe("banana")
    state.document.preferences.excludedIngredientKeys = ["apple"]
    expect(projectShoppingDocument(state.document).excluded[0].orderingKey).toBe("apple")

    state = applyShoppingDocumentMutation(state, { type: "removeRecipe", recipeId: "b" })
    expect(state.document.preferences.ingredientOrderByCategory.produce)
      .toEqual(["banana", "apple"])
    state = applyShoppingDocumentMutation(state, { type: "complete" })
    expect(state.document.preferences.ingredientOrderByCategory.produce)
      .toEqual(["banana", "apple"])
    state.document.preferences.excludedIngredientKeys = []
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipes", entries: [
      entry("a", "apple"),
      entry("b", "banana"),
    ] })
    expect(projectShoppingDocument(state.document).rows.map((row) => row.orderingKey))
      .toEqual(["banana", "apple"])
  })

  it("moves a manual row and teaches an equivalent future recipe ingredient", () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries.a = entry("a", "milk", 1, { unit: "cup" })
    document.manualItems.push({
      id: "manual-paper",
      displayName: "paper towels",
      quantity: null,
      categoryKey: "misc",
      bucket: "items",
      checked: false,
    })
    let state: ShoppingDocumentStateV2 = { document, contentRevision: 0 }
    const rows = projectShoppingDocument(document).rows
    const manual = rows.find((row) => row.manualId === "manual-paper")!
    const milk = rows.find((row) => row.orderingKey === "milk")!
    state = applyShoppingDocumentMutation(state, {
      type: "learnOrder",
      draggedRowRef: manual.rowRef,
      draggedOrderingKey: manual.orderingKey,
      sourceCategoryKey: manual.categoryKey,
      targetRowRef: milk.rowRef,
      targetOrderingKey: milk.orderingKey,
      targetCategoryKey: milk.categoryKey,
      placement: "after",
    })
    expect(state.document.manualItems[0].categoryKey).toBe("dairy")
    expect(state.document.preferences.categoryByIngredient["paper towels"]).toBe("dairy")
    state = applyShoppingDocumentMutation(state, { type: "deleteManualItem", id: "manual-paper" })
    state = applyShoppingDocumentMutation(state, {
      type: "upsertRecipe",
      entry: entry("b", "paper towels"),
    })
    expect(projectShoppingDocument(state.document).rows.map((row) => [
      row.orderingKey,
      row.categoryKey,
    ])).toEqual([
      ["milk", "dairy"],
      ["paper towels", "dairy"],
    ])
  })

  it("increments once for a change and replays idempotently on a refetched document", () => {
    const initial = { document: createEmptyShoppingDocument(), contentRevision: 10 }
    const mutation = { type: "upsertRecipe", entry: entry("a", "apple") } as const
    const applied = applyShoppingDocumentMutation(initial, mutation)
    const replayed = applyShoppingDocumentMutation({
      document: applied.document,
      contentRevision: 20,
    }, mutation)
    expect(applied.contentRevision).toBe(11)
    expect(replayed.contentRevision).toBe(20)
  })

  it("replays a manual checked intent without overwriting concurrent fields", () => {
    const document = createEmptyShoppingDocument()
    document.manualItems.push({
      id: "m",
      displayName: "concurrently renamed foil",
      quantity: null,
      categoryKey: "misc",
      bucket: "items",
      checked: false,
    })
    const replayed = applyShoppingDocumentMutation(
      { document, contentRevision: 8 },
      { type: "setChecked", rowRef: "manual:m", checked: true }
    )
    expect(replayed.document.manualItems[0]).toMatchObject({
      displayName: "concurrently renamed foil",
      checked: true,
    })
    expect(replayed.contentRevision).toBe(9)
  })

  it("complete clears content intent and retains preferences", () => {
    const document = populated()
    document.preferences.excludeSaltVariants = true
    const completed = applyShoppingDocumentMutation({ document, contentRevision: 1 }, { type: "complete" })
    expect(completed.document).toMatchObject({
      recipeEntries: {}, manualItems: [], itemOverrides: {},
      preferences: {
        excludeSaltVariants: true,
        ingredientOrderByCategory: {
          produce: ["apple"],
          misc: ["paper towels"],
        },
      },
    })
    expect(completed.contentRevision).toBe(2)
  })
})

describe("ShoppingDocumentV1 migration", () => {
  it("seeds reusable order, absorbs derived category overrides, and drops row order", () => {
    const appleEntry = entry("a", "apple")
    const milkEntry = entry("b", "milk", 1, { unit: "cup" })
    const appleKey = appleEntry.ingredients[0].aggregateKey
    const milkKey = milkEntry.ingredients[0].aggregateKey
    const v1: ShoppingDocumentV1 = {
      schemaVersion: 1,
      recipeEntries: { a: appleEntry, b: milkEntry },
      manualItems: [{
        id: "manual-a",
        displayName: "paper towels",
        quantity: null,
        categoryKey: "misc",
        bucket: "items",
        checked: false,
      }],
      itemOverrides: {
        [appleKey]: { categoryKey: "dairy" },
      },
      order: [
        `derived:${milkKey}`,
        `derived:${appleKey}`,
        "manual:manual-a",
      ],
      preferences: {
        categoryByIngredient: {},
        customCategories: [],
        categoryOrder: [],
        excludedIngredientKeys: [],
        excludeSaltVariants: false,
        excludeBlackPepperVariants: false,
      },
    }

    const migrated = upgradeShoppingDocumentV1(v1)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.document).not.toHaveProperty("order")
    expect(migrated.document.itemOverrides).toEqual({})
    expect(migrated.document.preferences.categoryByIngredient.apple).toBe("dairy")
    expect(migrated.document.preferences.ingredientOrderByCategory).toEqual({
      dairy: ["milk", "apple"],
      misc: ["paper towels"],
    })
  })

  it("ignores stale row refs, deduplicates identities, and appends partially represented rows", () => {
    const appleEntry = entry("a", "apple")
    const secondApple = entry("b", "apples")
    const carrotEntry = entry("c", "carrot")
    const v1: ShoppingDocumentV1 = {
      schemaVersion: 1,
      recipeEntries: { a: appleEntry, b: secondApple, c: carrotEntry },
      manualItems: [],
      itemOverrides: {},
      order: [
        "derived:stale-aggregate",
        `derived:${secondApple.ingredients[0].aggregateKey}`,
      ],
      preferences: {
        categoryByIngredient: {},
        customCategories: [],
        categoryOrder: [],
        excludedIngredientKeys: [],
        excludeSaltVariants: false,
        excludeBlackPepperVariants: false,
      },
    }

    const migrated = upgradeShoppingDocumentV1(v1)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.document.preferences.ingredientOrderByCategory.produce).toEqual([
      "apple",
      "carrot",
    ])
  })
})
