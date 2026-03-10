import { describe, expect, it } from "vitest"

import {
  applyParsedRecipeToFormValues,
  buildNewRecipeDialogFormValues,
  buildRecipeSubmissionData,
  clampRecipeServings,
  isEditingRecipeDialogDirty,
  isNewRecipeDialogDirty,
  normalizeRecipeIngredient,
} from "../recipe-dialog.defaults"
import {
  analyzeIngredientDuplicates,
  autoFixIngredients,
  countBlockingIngredientIssues,
  countIngredientsWithIssues,
  removeExactDuplicateIngredients,
  validateIngredient,
} from "../recipe-dialog.validation"
import {
  IMPORT_TEXT_REQUIRED_ERROR,
  IMPORT_URL_INVALID_ERROR,
  parseRecipeImportPreview,
  parseRecipeImportText,
  toParsedRecipeImport,
  validateRecipeImportUrl,
} from "../recipe-import.parser"

describe("recipe dialog validation helpers", () => {
  it("ignores untouched blank rows and validates inconsistent amount/unit pairs", () => {
    expect(validateIngredient({ item: "", amount: null, unit: "" })).toEqual([])
    expect(validateIngredient({ item: "   ", amount: 1, unit: "" })).toEqual([
      "missing-item",
      "amount-without-unit",
    ])
    expect(validateIngredient({ item: "Flour", amount: null, unit: "cups" })).toEqual([
      "unit-without-amount",
    ])
    expect(validateIngredient({ item: "Bananas", amount: 3, unit: "" })).toEqual([
      "amount-without-unit",
    ])
  })

  it("auto-fixes unit without amount by defaulting to 1", () => {
    const result = autoFixIngredients([
      { item: "Flour", amount: null, unit: "cups" },
    ])

    expect(result.ingredients[0]).toMatchObject({ item: "Flour", amount: 1, unit: "cups" })
    expect(result.fixedCount).toBe(1)
  })

  it("counts issue totals and blocking issues separately", () => {
    const ingredients = [
      { item: "", amount: null, unit: "" },
      { item: "Flour", amount: null, unit: "cups" },
      { item: "Bananas", amount: 3, unit: "" },
    ]

    expect(countIngredientsWithIssues(ingredients)).toBe(2)
    expect(countBlockingIngredientIssues(ingredients)).toBe(1)
  })

  it("detects exact duplicates and near-duplicate naming variants", () => {
    const result = analyzeIngredientDuplicates([
      { item: "olive oil", amount: 1, unit: "tbsp" },
      { item: "olive oil", amount: 1, unit: "tbsp" },
      { item: "extra virgin olive oil", amount: 2, unit: "tbsp" },
      { item: "yellow onion", amount: 1, unit: "" },
      { item: "onion", amount: 2, unit: "" },
    ])

    expect(result.exactGroups).toHaveLength(1)
    expect(result.exactGroups[0].rowIndexes).toEqual([0, 1])
    expect(result.nearGroups).toHaveLength(1)
    expect(result.nearGroups.map((group) => group.canonicalItem)).toEqual([
      "onion",
    ])
    expect(result.rowWarnings[1]).toContain("Exact duplicate of row 1")
    expect(result.rowWarnings[4]).toContain("Possible duplicate of row 4")
  })

  it("removes only exact duplicates and preserves near-duplicates", () => {
    const result = removeExactDuplicateIngredients([
      { item: "olive oil", amount: 1, unit: "tbsp" },
      { item: "olive oil", amount: 1, unit: "tbsp" },
      { item: "extra virgin olive oil", amount: 1, unit: "tbsp" },
    ])

    expect(result.removedCount).toBe(1)
    expect(result.ingredients).toEqual([
      { item: "olive oil", amount: 1, unit: "tbsp" },
      { item: "extra virgin olive oil", amount: 1, unit: "tbsp" },
    ])
  })
})

describe("recipe import helpers", () => {
  it("returns the required text error for blank imports", () => {
    expect(parseRecipeImportText("   ")).toEqual({
      parsedRecipe: null,
      error: IMPORT_TEXT_REQUIRED_ERROR,
    })
  })

  it("parses live preview safely", () => {
    expect(parseRecipeImportPreview("   ")).toBeNull()
    expect(
      parseRecipeImportPreview("Toast\n\nIngredients:\n1 slice bread\n\nInstructions:\nToast it")
    ).toMatchObject({
      name: "Toast",
      ingredients: [{ item: "bread", amount: 1, unit: "slice" }],
    })
  })

  it("validates URL imports and maps extracted URL results", () => {
    expect(validateRecipeImportUrl("notaurl")).toEqual({
      normalizedUrl: null,
      error: IMPORT_URL_INVALID_ERROR,
    })
    expect(validateRecipeImportUrl(" https://example.com/recipe ")).toEqual({
      normalizedUrl: "https://example.com/recipe",
      error: null,
    })
    expect(
      toParsedRecipeImport({
        name: "Soup",
        ingredients: [{ item: "water", amount: 1, unit: "cup" }],
        instructions: ["Boil"],
        servings: 2,
        imageUrl: "https://example.com/soup.jpg",
        warnings: ["warning"],
      })
    ).toEqual({
      name: "Soup",
      ingredients: [{ item: "water", amount: 1, unit: "cup" }],
      instructions: ["Boil"],
      servings: 2,
      warnings: ["warning"],
    })
  })
})

describe("recipe dialog defaults helpers", () => {
  it("normalizes ingredient data for cleaner downstream storage", () => {
    expect(
      normalizeRecipeIngredient({
        item: "  green   onions  ",
        amount: 2,
        unit: "Tablespoons",
        modifier: "  finely   chopped ",
        alternatives: [" sour cream ", " greek  yogurt "],
        originalText: " 2 Tablespoons green onions, finely chopped ",
      })
    ).toEqual({
      item: "green onions",
      amount: 2,
      unit: "tbsp",
      modifier: "finely chopped",
      alternatives: ["sour cream", "greek yogurt"],
      originalText: "2 Tablespoons green onions, finely chopped",
    })
  })

  it("builds new form defaults and submission payloads", () => {
    const defaults = buildNewRecipeDialogFormValues(["dinner"])

    expect(defaults).toEqual({
      name: "",
      category: "dinner",
      servings: 4,
      tags: [],
      ingredients: [{ item: "", amount: null, unit: "" }],
      instructions: "",
      imageUrl: null,
    })

    expect(
      buildRecipeSubmissionData({
        ...defaults,
        name: "  Soup  ",
        tags: ["easy"],
        ingredients: [
          { item: " water ", amount: 1, unit: " Cups ", modifier: "  chilled " },
          { item: "", amount: null, unit: "" },
        ],
        instructions: " Boil \n\n Serve ",
      })
    ).toEqual({
      name: "Soup",
      category: "dinner",
      servings: 4,
      tags: ["easy"],
      ingredients: [{ item: "water", amount: 1, unit: "cup", modifier: "chilled" }],
      instructions: ["Boil", "Serve"],
      image_url: null,
    })
  })

  it("applies parsed preview values without overwriting missing fields", () => {
    expect(
      applyParsedRecipeToFormValues(
        {
          name: "Fallback",
          category: "dinner",
          servings: 4,
          tags: [],
          ingredients: [{ item: "Eggs", amount: 2, unit: "" }],
          instructions: "Cook",
          imageUrl: null,
        },
        {
          name: "",
          ingredients: [{ item: "Bread", amount: 1, unit: "slice" }],
          instructions: [],
          warnings: [],
        }
      )
    ).toEqual({
      name: "Fallback",
      category: "dinner",
      servings: 4,
      tags: [],
      ingredients: [{ item: "Bread", amount: 1, unit: "slice" }],
      instructions: "Cook",
      imageUrl: null,
    })
  })

  it("detects dirty state and clamps servings", () => {
    expect(
      isNewRecipeDialogDirty({
        name: "",
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructions: "",
      })
    ).toBe(false)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        ingredients: [{ item: "Flour", amount: null, unit: "" }],
        instructions: "",
      })
    ).toBe(true)
    expect(
      isEditingRecipeDialogDirty(
        {
          name: "Soup",
          category: "dinner",
          servings: 4,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructions: "Boil",
          imageUrl: "https://example.com/soup.jpg",
        },
        {
          name: "Soup",
          category: "dinner",
          servings: 4,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructions: "Boil",
          imageUrl: "https://example.com/soup.jpg",
          imageReference: "https://example.com/soup.jpg",
        }
      )
    ).toBe(false)
    expect(
      isEditingRecipeDialogDirty(
        {
          name: "Soup",
          category: "dinner",
          servings: 4,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructions: "Boil",
          imageUrl: "https://example.com/soup.jpg",
        },
        {
          name: "Soup Deluxe",
          category: "dinner",
          servings: 4,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructions: "Boil",
          imageUrl: "https://example.com/soup.jpg",
          imageReference: "https://example.com/soup.jpg",
        }
      )
    ).toBe(true)
    expect(clampRecipeServings(0)).toBe(1)
    expect(clampRecipeServings(101)).toBe(100)
  })
})
