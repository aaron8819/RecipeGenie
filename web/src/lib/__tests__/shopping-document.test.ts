import { describe, expect, it } from "vitest"
import type { PantryItem } from "@/types/database"
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  projectShoppingDocument,
  validateShoppingDocumentStateV1,
  validateShoppingDocumentV1,
  type ShoppingDocumentStateV1,
  type ShoppingDocumentV1,
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

function populated(): ShoppingDocumentV1 {
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
  document.order = [`manual:manual-a`, `derived:${key}`]
  return document
}

describe("ShoppingDocumentV1 validation", () => {
  it("accepts exact empty and populated documents", () => {
    expect(validateShoppingDocumentV1(createEmptyShoppingDocument()).ok).toBe(true)
    expect(validateShoppingDocumentV1(populated()).ok).toBe(true)
  })

  it.each([
    ["wrong version", (value: any) => { value.schemaVersion = 2 }],
    ["duplicate recipe identity", (value: any) => { value.recipeEntries.other = { ...value.recipeEntries.a } }],
    ["duplicate manual identity", (value: any) => { value.manualItems.push({ ...value.manualItems[0] }) }],
    ["malformed override", (value: any) => { value.itemOverrides[Object.keys(value.itemOverrides)[0]] = { checked: "yes" } }],
    ["invalid order reference", (value: any) => { value.order.push("manual:missing") }],
    ["persisted projection", (value: any) => { value.items = [] }],
  ])("rejects %s", (_label, mutate) => {
    const value = populated() as any
    mutate(value)
    expect(validateShoppingDocumentV1(value).ok).toBe(false)
  })

  it("validates the external CAS revision", () => {
    expect(validateShoppingDocumentStateV1({
      document: createEmptyShoppingDocument(),
      contentRevision: -1,
    }).ok).toBe(false)
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

  it("applies derived overrides, ingredient preferences, manual rows, and order", () => {
    const document = populated()
    const key = document.recipeEntries.a.ingredients[0].aggregateKey
    document.itemOverrides[key] = {
      displayName: "edited apples",
      quantity: null,
      categoryKey: "dairy",
      bucket: "excluded",
      checked: true,
    }
    document.preferences.categoryByIngredient.apple = "produce"
    const projection = projectShoppingDocument(document)

    expect(projection.rows.map((row) => row.rowRef)).toEqual([
      "manual:manual-a",
      `derived:${key}`,
    ])
    expect(projection.rows[1]).toMatchObject({
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
    let state: ShoppingDocumentStateV1 = { document: createEmptyShoppingDocument(), contentRevision: 0 }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipe", entry: entry("a", "apple") })
    const key = state.document.recipeEntries.a.ingredients[0].aggregateKey
    state = applyShoppingDocumentMutation(state, { type: "setChecked", rowRef: `derived:${key}`, checked: true })
    state = applyShoppingDocumentMutation(state, { type: "rescaleRecipe", entry: entry("a", "milk", 2, { unit: "cup" }) })
    expect(Object.keys(state.document.recipeEntries)).toEqual(["a"])
    expect(state.document.itemOverrides).toEqual({})
    state = applyShoppingDocumentMutation(state, { type: "removeRecipe", recipeId: "a" })
    expect(state.document.recipeEntries).toEqual({})
  })

  it("supports explicit overrides, ingredient preference, manual lifecycle, and ordering", () => {
    let state: ShoppingDocumentStateV1 = { document: createEmptyShoppingDocument(), contentRevision: 4 }
    state = applyShoppingDocumentMutation(state, { type: "upsertRecipe", entry: entry("a", "apple") })
    const key = state.document.recipeEntries.a.ingredients[0].aggregateKey
    const mutations = [
      { type: "setQuantityOverride", aggregateKey: key, quantity: null },
      { type: "setDisplayNameOverride", aggregateKey: key, displayName: "apples" },
      { type: "setCategoryOverride", aggregateKey: key, categoryKey: "pantry" },
      { type: "setIngredientCategory", ingredientKey: "apple", categoryKey: "produce" },
      { type: "addManualItem", item: { id: "m", displayName: "foil", quantity: null, categoryKey: "misc", bucket: "items", checked: false } },
    ] as const
    for (const mutation of mutations) state = applyShoppingDocumentMutation(state, mutation)
    state = applyShoppingDocumentMutation(state, { type: "setOrder", order: ["manual:m", `derived:${key}`] })
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
    expect(state.document.order).toEqual(["manual:m", `derived:${key}`])
    expect(state.document.manualItems[0].displayName).toBe("foil roll")
    expect(state.document.manualItems[0].checked).toBe(true)
    state = applyShoppingDocumentMutation(state, { type: "deleteManualItem", id: "m" })
    expect(state.document.order).toEqual([`derived:${key}`])
  })

  it("writes a category override and its future ingredient preference together", () => {
    let state: ShoppingDocumentStateV1 = {
      document: createEmptyShoppingDocument(),
      contentRevision: 2,
    }
    state = applyShoppingDocumentMutation(state, {
      type: "upsertRecipe",
      entry: entry("a", "apple"),
    })
    const ingredient = state.document.recipeEntries.a.ingredients[0]
    state = applyShoppingDocumentMutation(state, {
      type: "setCategoryOverride",
      aggregateKey: ingredient.aggregateKey,
      categoryKey: "pantry",
    })
    expect(state.document.itemOverrides[ingredient.aggregateKey].categoryKey).toBe("pantry")
    expect(state.document.preferences.categoryByIngredient[ingredient.ingredientKey]).toBe("pantry")
    expect(state.contentRevision).toBe(4)
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
      recipeEntries: {}, manualItems: [], itemOverrides: {}, order: [],
      preferences: { excludeSaltVariants: true },
    })
    expect(completed.contentRevision).toBe(2)
  })
})
