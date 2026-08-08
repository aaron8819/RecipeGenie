import { describe, expect, it } from "vitest"
import { parseIngredientLine } from "../recipe-parser"
import { generateShoppingList } from "../shopping-list"
import { mergeShoppingItems } from "../shopping-list-merging"
import type {
  Ingredient,
  PantryItem,
  Recipe,
  ShoppingItem,
} from "@/types/database"
import { canonicalizeRecipeFixture } from "@/test/recipe-fixtures"

function recipe(id: string, ingredients: Ingredient[]): Recipe {
  return canonicalizeRecipeFixture({
    id,
    name: `Recipe ${id}`,
    servings: 4,
    fixtureIngredients: ingredients,
  })
}

function fromLines(...lines: string[]): Recipe[] {
  return lines.map((line, index) =>
    recipe(`recipe-${index + 1}`, [parseIngredientLine(line)])
  )
}

function generatedItems(...lines: string[]) {
  const result = generateShoppingList(fromLines(...lines), [], [])
  return [...result.items, ...result.alreadyHave, ...result.excluded]
}

describe("shopping canonicalization behavior matrix", () => {
  const additiveCases = [
    ["1 egg", "2 eggs", "egg", 3, "count"],
    ["1 large egg", "2 large eggs", "large egg", 3, "count"],
    ["1 onion", "2 onions", "onion", 3, "count"],
    ["1/2 cup milk", "½ cup milk", "milk", 1, "cup"],
    ["1/2 cup milk", "1 cup milk", "milk", 1.5, "cup"],
    ["1 cup milk", "4 fl oz milk", "milk", 1.5, "cup"],
  ] as const

  it.each(additiveCases)(
    "merges %s with %s",
    (left, right, item, amount, unit) => {
      expect(generatedItems(left, right)).toEqual([
        expect.objectContaining({ item, amount, unit }),
      ])
    }
  )

  it("merges preparation variants and preserves each source instruction", () => {
    const items = generatedItems("1 diced onion", "2 sliced onions")

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ item: "onion", amount: 3, unit: "count" })
    expect(items[0].sources).toEqual([
      expect.objectContaining({
        originalText: "1 diced onion",
        preparationModifiers: ["diced"],
      }),
      expect.objectContaining({
        originalText: "2 sliced onions",
        preparationModifiers: ["sliced"],
      }),
    ])
  })

  it("treats optionality as source metadata instead of purchase identity", () => {
    const items = generatedItems("optional parsley", "parsley")

    expect(items).toHaveLength(1)
    expect(items[0].item).toBe("parsley")
    expect(items[0].sources).toEqual([
      expect.objectContaining({ optional: true }),
      expect.objectContaining({ optional: false }),
    ])
  })

  const incompatibleIdentities = [
    ["egg", "egg white"],
    ["large egg", "quail egg"],
    ["large egg", "egg"],
    ["red onion", "yellow onion"],
    ["green onion", "onion"],
    ["medium onion", "large onion"],
    ["whole milk", "evaporated milk"],
    ["tomato", "tomato sauce"],
    ["tomato", "tomato paste"],
    ["garlic", "garlic powder"],
    ["chicken breast", "chicken thighs"],
    ["boneless chicken breast", "chicken breast"],
    ["fresh parsley", "dried parsley"],
    ["olive oil", "extra-virgin olive oil"],
    ["canned tomatoes", "fresh tomatoes"],
    ["kosher salt", "salt"],
  ] as const

  it.each(incompatibleIdentities)("does not merge %s with %s", (left, right) => {
    expect(generatedItems(left, right)).toHaveLength(2)
  })

  it("does not merge equal identities assigned to different effective categories", () => {
    const result = generateShoppingList(
      [
        recipe("a", [
          { item: "egg", amount: 1, unit: "count", shoppingCategory: "dairy" },
        ]),
        recipe("b", [
          { item: "eggs", amount: 2, unit: "count", shoppingCategory: "pantry" },
        ]),
      ],
      [],
      []
    )

    expect(result.items).toHaveLength(2)
    expect(result.items.map((item) => item.categoryKey).sort()).toEqual([
      "dairy",
      "pantry",
    ])
  })

  it("does not merge manual and recipe-derived rows", () => {
    const base: Omit<ShoppingItem, "sources" | "rowId"> = {
      item: "egg",
      amount: 1,
      unit: "count",
      categoryKey: "dairy",
      categoryOrder: 5,
    }
    const result = mergeShoppingItems(
      [{
        ...base,
        rowId: "manual-egg",
        sources: [{ recipeName: "Manual" }],
      }],
      [{
        ...base,
        amount: 2,
        sources: [{ recipeId: "recipe-a", recipeName: "Recipe A" }],
      }]
    )

    expect(result).toHaveLength(2)
    expect(result.find((item) => item.rowId === "manual-egg")?.amount).toBe(1)
  })

  it("keeps pantry and exclusion matching compatible with safe plural aliases", () => {
    const eggRecipe = recipe("egg", [parseIngredientLine("1 egg")])
    const pantryResult = generateShoppingList(
      [eggRecipe],
      [{ item: "eggs" } as PantryItem],
      []
    )
    const excludedResult = generateShoppingList([eggRecipe], [], ["eggs"])

    expect(pantryResult.alreadyHave).toEqual([
      expect.objectContaining({ item: "egg" }),
    ])
    expect(excludedResult.excluded).toEqual([
      expect.objectContaining({ item: "egg", excludedBy: "eggs" }),
    ])
  })

  it("does not broaden pantry or exclusion matches across identity modifiers", () => {
    const parsleyRecipe = recipe("parsley", [
      parseIngredientLine("fresh parsley"),
    ])
    const result = generateShoppingList(
      [parsleyRecipe],
      [{ item: "parsley" } as PantryItem],
      ["parsley"]
    )

    expect(result.items).toEqual([
      expect.objectContaining({ item: "fresh parsley" }),
    ])
    expect(result.alreadyHave).toEqual([])
    expect(result.excluded).toEqual([])
  })

  it("does not infer uncontrolled singular/plural exclusion aliases", () => {
    const result = generateShoppingList(
      [recipe("candy", [{ item: "candies", amount: 2, unit: "count" }])],
      [],
      ["candy"]
    )

    expect(result.items).toEqual([
      expect.objectContaining({ item: "candies", amount: 2 }),
    ])
    expect(result.excluded).toEqual([])
  })

  it("preserves ranges separately from arithmetic quantities", () => {
    const sugar = generatedItems("1–2 tbsp sugar", "1 tbsp sugar")

    expect(sugar).toHaveLength(2)
    expect(sugar[0]).toMatchObject({
      amount: null,
      unit: "tbsp",
      exactQuantityV1: {
        kind: "range",
        start: { numerator: "1", denominator: "1" },
        end: { numerator: "2", denominator: "1" },
      },
    })
    expect(sugar[0].additionalAmounts).toBeUndefined()
    expect(sugar[1]).toMatchObject({ amount: 1, unit: "tbsp" })
  })

  it.each([
    ["1 cup flour", "100 g flour", "cup", "g"],
    ["1 can tomatoes", "1 cup tomatoes", "can", "cup"],
    ["1 package cheese", "4 oz cheese", "package", "oz"],
  ])("preserves incompatible quantities for %s and %s", (left, right, unit, otherUnit) => {
    const [item] = generatedItems(left, right)

    expect(item.unit).toBe(unit)
    expect(item.additionalAmounts).toEqual([
      expect.objectContaining({ unit: otherUnit }),
    ])
  })

  it("does not drop an incompatible amount when a later compatible amount merges", () => {
    const [flour] = generatedItems(
      "1 cup flour",
      "100 g flour",
      "1 cup flour"
    )

    expect(flour).toMatchObject({ amount: 2, unit: "cup" })
    expect(flour.additionalAmounts).toEqual([{ amount: 100, unit: "g" }])
  })

  it("merges compatible weight, decimal, count, and package quantities", () => {
    expect(generatedItems("1 lb carrots", "8 oz carrots")).toEqual([
      expect.objectContaining({ item: "carrot", amount: 1.5, unit: "lb" }),
    ])
    expect(generatedItems("0.5 cup milk", "0.5 cup milk")).toEqual([
      expect.objectContaining({ item: "milk", amount: 1, unit: "cup" }),
    ])
    expect(generatedItems("1 count eggs", "2 counts eggs")).toEqual([
      expect.objectContaining({ item: "egg", amount: 3, unit: "count" }),
    ])
    expect(generatedItems("1 package tortillas", "2 packages tortillas")).toEqual([
      expect.objectContaining({ item: "tortillas", amount: 3, unit: "package" }),
    ])
  })
})
