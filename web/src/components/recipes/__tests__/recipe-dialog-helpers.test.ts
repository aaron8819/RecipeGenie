import { describe, expect, it } from "vitest"

import {
  applyParsedRecipeToFormValues,
  buildEditingRecipeDialogFormValues,
  buildNewRecipeDialogFormValues,
  buildRecipeSubmissionData,
  clampRecipeServings,
  isEditingRecipeDialogDirty,
  isNewRecipeDialogDirty,
  normalizeRecipeIngredient,
} from "../recipe-dialog.defaults"
import type { Recipe } from "@/types/database"
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
import { STRUCTURED_LAMB_RECIPE_TEXT } from "@/lib/__tests__/recipe-parser.fixtures"

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
    expect(validateIngredient({ item: "Bananas", amount: 3, unit: "" })).toEqual([])
    expect(validateIngredient({ item: "eggs", amount: 2, unit: "count" })).toEqual([])
    expect(validateIngredient({ item: "", amount: null, unit: "cup" })).toEqual([
      "missing-item",
      "unit-without-amount",
    ])
    expect(validateIngredient({ item: "", amount: null, unit: "", modifier: "diced" })).toEqual([
      "missing-item",
    ])
  })

  it("auto-fixes unit without amount by defaulting to 1", () => {
    const result = autoFixIngredients([
      { item: "Flour", amount: null, unit: "cups" },
    ])

    expect(result.ingredients[0]).toMatchObject({ item: "Flour", amount: 1, unit: "cups" })
    expect(result.fixedCount).toBe(1)
  })

  it("auto-fixes countable whole ingredients to the count unit", () => {
    const result = autoFixIngredients([
      { item: "1 onion", amount: null, unit: "" },
      { item: "red bell pepper", amount: 1, unit: "", modifier: "sliced" },
      { item: "2 eggs", amount: null, unit: "" },
    ])

    expect(result.ingredients).toMatchObject([
      { item: "onion", amount: 1, unit: "count" },
      { item: "red bell pepper", amount: 1, unit: "count", modifier: "sliced" },
      { item: "eggs", amount: 2, unit: "count" },
    ])
    expect(result.fixedCount).toBe(3)
  })

  it("accepts normal countable whole ingredient rows", () => {
    const validIngredients = [
      { item: "onion", amount: 1, unit: "" },
      { item: "red bell pepper", amount: 1, unit: "" },
      { item: "carrots", amount: 2, unit: "" },
      { item: "lime", amount: 1, unit: "" },
      { item: "avocado", amount: 0.5, unit: "" },
      { item: "eggs", amount: 2, unit: "" },
      { item: "chicken breast", amount: 1, unit: "" },
      { item: "lime", amount: 1, unit: "count" },
    ]

    for (const ingredient of validIngredients) {
      expect(validateIngredient(ingredient)).toEqual([])
    }
  })

  it("counts issue totals and blocking issues separately", () => {
    const ingredients = [
      { item: "", amount: null, unit: "" },
      { item: "Flour", amount: null, unit: "cups" },
      { item: "Bananas", amount: 3, unit: "" },
    ]

    expect(countIngredientsWithIssues(ingredients)).toBe(1)
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

  it("does not flag exact duplicates across different imported ingredient groups", () => {
    const result = analyzeIngredientDuplicates([
      { item: "butter", amount: 1, unit: "tbsp" },
      { item: "butter", amount: 1, unit: "tbsp", groupLabel: "Pan Sauce" },
    ])

    expect(result.exactGroups).toHaveLength(0)
    expect(result.nearGroups).toHaveLength(0)
    expect(result.rowWarnings).toEqual({})
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

  it("keeps grouped ingredient metadata and note fallback in import previews", () => {
    const preview = parseRecipeImportPreview(STRUCTURED_LAMB_RECIPE_TEXT)

    expect(preview).not.toBeNull()
    expect(preview?.ingredientGroups?.[1].label).toBe("Pan Sauce")
    expect(preview?.ingredients[7].groupLabel).toBe("Pan Sauce")
    expect(preview?.instructions).toContain("Notes:")
    expect(preview?.notes).toHaveLength(3)
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

    expect(
      normalizeRecipeIngredient({
        item: " lime ",
        amount: 1,
        unit: " whole/count ",
      })
    ).toEqual({
      item: "lime",
      amount: 1,
      unit: "count",
    })
  })

  it("builds new form defaults and submission payloads", () => {
    const defaults = buildNewRecipeDialogFormValues(["dinner"])

    expect(defaults).toEqual({
      name: "",
      category: "dinner",
      servings: 4,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
      ingredients: [{ item: "", amount: null, unit: "" }],
      instructionGroups: [{ steps: [""] }],
      notes: "",
      imageUrl: null,
    })

    expect(
      buildRecipeSubmissionData({
        ...defaults,
        name: "  Soup  ",
        tags: ["easy"],
        ingredients: [
          { item: " water ", amount: 1, unit: " Cups ", modifier: "  chilled " },
          { item: " onion ", amount: 1, unit: "" },
          { item: "", amount: null, unit: "" },
        ],
        instructionGroups: [{ steps: [" Boil ", "", " Serve "] }],
      })
    ).toEqual({
      name: "Soup",
      category: "dinner",
      servings: 4,
      prep_time_minutes: null,
      cook_time_minutes: null,
      total_time_minutes: null,
      tags: ["easy"],
      ingredients: [
        { item: "water", amount: 1, unit: "cup", modifier: "chilled" },
        { item: "onion", amount: 1, unit: "count" },
      ],
      instructions: ["Boil", "Serve"],
      instruction_groups: [{ steps: ["Boil", "Serve"] }],
      notes: [],
      image_url: null,
    })
  })

  it("preserves ingredient group labels through normalization and submission", () => {
    expect(
      buildRecipeSubmissionData({
        name: "Grouped",
        category: "dinner",
        servings: 2,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        tags: [],
        ingredients: [
          { item: "butter", amount: 1, unit: "Tablespoons", groupLabel: " Pan Sauce " },
        ],
        instructionGroups: [{ steps: ["Cook"] }],
        notes: "",
        imageUrl: null,
      })
    ).toEqual({
      name: "Grouped",
      category: "dinner",
      servings: 2,
      prep_time_minutes: null,
      cook_time_minutes: null,
      total_time_minutes: null,
      tags: [],
      ingredients: [
        { item: "butter", amount: 1, unit: "tbsp", groupLabel: "Pan Sauce" },
      ],
      instructions: ["Cook"],
      instruction_groups: [{ steps: ["Cook"] }],
      notes: [],
      image_url: null,
    })
  })

  it("removes empty instruction groups, blank labels, and whitespace-only steps on submit", () => {
    expect(
      buildRecipeSubmissionData({
        name: "Normalized",
        category: "dinner",
        servings: 2,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        tags: [],
        ingredients: [{ item: "water", amount: 1, unit: "cup" }],
        instructionGroups: [
          { label: "  ", steps: ["  Boil water  ", "   "] },
          { label: " Sauce ", steps: [" ", "Finish with butter"] },
          { steps: ["   "] },
        ],
        notes: "  Serve warm  ",
        imageUrl: null,
      })
    ).toEqual({
      name: "Normalized",
      category: "dinner",
      servings: 2,
      prep_time_minutes: null,
      cook_time_minutes: null,
      total_time_minutes: null,
      tags: [],
      ingredients: [{ item: "water", amount: 1, unit: "cup" }],
      instructions: ["Boil water", "Finish with butter"],
      instruction_groups: [
        { steps: ["Boil water"] },
        { label: "Sauce", steps: ["Finish with butter"] },
      ],
      notes: ["Serve warm"],
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
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          tags: [],
          ingredients: [{ item: "Eggs", amount: 2, unit: "" }],
          instructionGroups: [{ steps: ["Cook"] }],
          notes: "",
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
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
      ingredients: [{ item: "Bread", amount: 1, unit: "slice" }],
      instructionGroups: [{ steps: ["Cook"] }],
      notes: "",
      imageUrl: null,
    })
  })

  it("round-trips imported times, notes, and grouped instructions through save payload and edit hydration", () => {
    const preview = parseRecipeImportPreview(STRUCTURED_LAMB_RECIPE_TEXT)
    expect(preview).not.toBeNull()

    const applied = applyParsedRecipeToFormValues(
      buildNewRecipeDialogFormValues(["dinner"]),
      preview!
    )
    const submission = buildRecipeSubmissionData({
      ...applied,
      category: "dinner",
    })

    expect(submission.prep_time_minutes).toBe(10)
    expect(submission.cook_time_minutes).toBe(12)
    expect(submission.total_time_minutes).toBe(22)
    expect(submission.notes).toHaveLength(3)
    expect(submission.instructions).not.toContain("Notes:")
    expect(submission.instructions).not.toContain("Pan Sauce:")
    expect(submission.instruction_groups).toHaveLength(2)
    expect(submission.instruction_groups?.[0].steps[0]).toContain("Remove lamb shoulder chops")
    expect(submission.instruction_groups?.[1]).toMatchObject({
      label: "Pan Sauce",
    })
    expect(submission.instruction_groups?.[1].steps[0]).toBe("Lower heat to medium.")

    const hydrated = buildEditingRecipeDialogFormValues({
      id: "lamb-1",
      user_id: "user-1",
      name: submission.name,
      category: submission.category,
      servings: submission.servings ?? 4,
      favorite: false,
      tags: submission.tags ?? [],
      ingredients: submission.ingredients ?? [],
      instructions: submission.instructions ?? [],
      instruction_groups: submission.instruction_groups ?? null,
      notes: submission.notes ?? [],
      prep_time_minutes: submission.prep_time_minutes ?? null,
      cook_time_minutes: submission.cook_time_minutes ?? null,
      total_time_minutes: submission.total_time_minutes ?? null,
      image_url: submission.image_url ?? null,
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:00.000Z",
    } satisfies Recipe)

    expect(hydrated.prepTimeMinutes).toBe(10)
    expect(hydrated.cookTimeMinutes).toBe(12)
    expect(hydrated.totalTimeMinutes).toBe(22)
    expect(hydrated.notes).toContain("Lamb shoulder chops are flavorful")
    expect(hydrated.instructionGroups).toHaveLength(2)
    expect(hydrated.instructionGroups[1]?.label).toBe("Pan Sauce")
    expect(hydrated.instructionGroups[1]?.steps[0]).toBe("Lower heat to medium.")
  })

  it("applies pasted replacement text without changing preserved recipe identity fields", () => {
    const current = {
      name: "Original Mac",
      category: "dinner",
      servings: 4,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: ["family"],
      ingredients: [{ item: "old noodles", amount: 1, unit: "cup" }],
      instructionGroups: [{ steps: ["Old step"] }],
      notes: "Keep this note",
      imageUrl: "https://example.com/mac.jpg",
    }

    const parsed = parseRecipeImportPreview(`
Better Mac
Serves 6
Prep time: 10 minutes

Ingredients:
2 cups chicken broth
10 oz elbow noodles

Instructions:
1. Boil broth.
2. Stir in noodles.
`)

    expect(parsed).not.toBeNull()

    const applied = applyParsedRecipeToFormValues(current, parsed!)

    expect(applied.name).toBe("Better Mac")
    expect(applied.category).toBe("dinner")
    expect(applied.tags).toEqual(["family"])
    expect(applied.imageUrl).toBe("https://example.com/mac.jpg")
    expect(applied.servings).toBe(6)
    expect(applied.prepTimeMinutes).toBe(10)
    expect(applied.ingredients).toHaveLength(2)
    expect(applied.instructionGroups[0]?.steps).toEqual([
      "Boil broth.",
      "Stir in noodles.",
    ])
    expect(applied.notes).toBe("Keep this note")
  })

  it("separates legacy note label lines from instructions when hydrating older recipes", () => {
    const hydrated = buildEditingRecipeDialogFormValues({
      id: "legacy-1",
      user_id: "user-1",
      name: "Legacy",
      category: "dinner",
      servings: 4,
      favorite: false,
      tags: [],
      ingredients: [{ item: "Butter", amount: 1, unit: "tbsp" }],
      instructions: ["Pan Sauce:", "Whisk the sauce.", "Notes:", "Serve immediately."],
      image_url: null,
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:00.000Z",
    } satisfies Recipe)

    expect(hydrated.instructionGroups).toEqual([
      { label: "Pan Sauce", steps: ["Whisk the sauce."] },
    ])
    expect(hydrated.notes).toBe("Serve immediately.")
  })

  it("detects dirty state and clamps servings", () => {
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "",
        category: "",
        tags: [],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: null,
      })
    ).toBe(false)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "dinner",
        category: "dinner",
        tags: [],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: null,
      })
    ).toBe(false)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "",
        category: "",
        tags: [],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "Flour", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: null,
      })
    ).toBe(true)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "breakfast",
        category: "dinner",
        tags: [],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: null,
      })
    ).toBe(true)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "",
        category: "",
        tags: ["easy"],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: null,
      })
    ).toBe(true)
    expect(
      isNewRecipeDialogDirty({
        name: "",
        defaultCategory: "",
        category: "",
        tags: [],
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        ingredients: [{ item: "", amount: null, unit: "" }],
        instructionGroups: [{ steps: [""] }],
        notes: "",
        imageReference: "data:image/png;base64,mock",
      })
    ).toBe(true)
    expect(
      isEditingRecipeDialogDirty(
        {
          name: "Soup",
          category: "dinner",
          servings: 4,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructionGroups: [{ steps: ["Boil"] }],
          notes: "",
          imageUrl: "https://example.com/soup.jpg",
        },
        {
          name: "Soup",
          category: "dinner",
          servings: 4,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructionGroups: [{ steps: ["Boil"] }],
          notes: "",
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
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructionGroups: [{ steps: ["Boil"] }],
          notes: "",
          imageUrl: "https://example.com/soup.jpg",
        },
        {
          name: "Soup Deluxe",
          category: "dinner",
          servings: 4,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          tags: ["easy"],
          ingredients: [{ item: "Water", amount: 1, unit: "cup" }],
          instructionGroups: [{ steps: ["Boil"] }],
          notes: "",
          imageUrl: "https://example.com/soup.jpg",
          imageReference: "https://example.com/soup.jpg",
        }
      )
    ).toBe(true)
    expect(clampRecipeServings(0)).toBe(1)
    expect(clampRecipeServings(101)).toBe(100)
  })
})
