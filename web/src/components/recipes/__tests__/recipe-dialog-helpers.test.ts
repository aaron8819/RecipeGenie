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
import {
  MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT,
  MARKDOWN_TACO_SALAD_RECIPE_TEXT,
  STRUCTURED_LAMB_RECIPE_TEXT,
} from "@/lib/__tests__/recipe-parser.fixtures"

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
    ).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({
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
      yieldText: "4 servings",
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
    ).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({
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

  it("creates a canonical form and submission from Markdown import output", () => {
    const preview = parseRecipeImportPreview(
      MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT
    )

    expect(preview).not.toBeNull()

    const applied = applyParsedRecipeToFormValues(
      buildNewRecipeDialogFormValues(["dinner"]),
      preview!
    )
    const submission = buildRecipeSubmissionData(applied)

    expect(applied).toMatchObject({
      name: "Sesame Chicken",
      servings: 4,
      prepTimeMinutes: 20,
      cookTimeMinutes: 25,
      totalTimeMinutes: 45,
    })
    expect(applied.ingredients).toHaveLength(7)
    expect(applied.ingredients[0].groupLabel).toBe("Chicken")
    expect(applied.ingredients[3].groupLabel).toBe("Sesame Sauce")
    expect(applied.instructionGroups[0]?.steps).toHaveLength(16)
    expect(applied.notes).toContain("350°F")
    expect(submission.instruction_groups?.[0].steps).toHaveLength(16)
    expect(submission.notes).toEqual([
      "Keep the frying oil close to 350°F.",
      "Sauce the chicken immediately before serving.",
    ])
  })

  it("uses the same Taco Salad parse result for preview, import, and replacement", () => {
    const preview = parseRecipeImportPreview(MARKDOWN_TACO_SALAD_RECIPE_TEXT)
    const imported = parseRecipeImportText(MARKDOWN_TACO_SALAD_RECIPE_TEXT)

    expect(preview).not.toBeNull()
    expect(imported.error).toBeNull()
    expect(imported.parsedRecipe).toEqual(preview)

    const created = applyParsedRecipeToFormValues(
      buildNewRecipeDialogFormValues(["chicken", "beef"]),
      preview!,
      { applyCategory: true, categories: ["chicken", "beef"] }
    )
    expect(created).toMatchObject({
      name: "Taco Salad",
      category: "beef",
      servings: 4,
      prepTimeMinutes: 15,
      cookTimeMinutes: 10,
      totalTimeMinutes: 25,
    })
    expect(created.ingredients).toHaveLength(30)
    expect(created.instructionGroups[0]?.steps).toHaveLength(11)
    expect(created.notes.split("\n")).toHaveLength(4)

    const current = {
      ...buildNewRecipeDialogFormValues(["lamb"]),
      name: "Protected Recipe",
      category: "lamb",
      tags: ["preserve-me"],
      imageUrl: "https://example.com/preserved.jpg",
    }
    const replaced = applyParsedRecipeToFormValues(current, preview!)

    expect(replaced).toMatchObject({
      name: "Taco Salad",
      category: "lamb",
      tags: ["preserve-me"],
      imageUrl: "https://example.com/preserved.jpg",
    })
    expect(replaced.ingredients).toEqual(created.ingredients)
    expect(replaced.instructionGroups).toEqual(created.instructionGroups)
    expect(replaced.notes).toBe(created.notes)
  })

  it("matches imported categories case-insensitively and retains the fallback for unknown values", () => {
    const values = buildNewRecipeDialogFormValues(["Chicken", "Dinner Favorites"])

    expect(
      applyParsedRecipeToFormValues(
        values,
        {
          name: "Roast Chicken",
          category: "chicken",
          ingredients: [],
          instructions: [],
          warnings: [],
        },
        {
          applyCategory: true,
          categories: ["Chicken", "Dinner Favorites"],
        }
      ).category
    ).toBe("Chicken")

    expect(
      applyParsedRecipeToFormValues(
        values,
        {
          name: "Fish Tacos",
          category: "seafood",
          ingredients: [],
          instructions: [],
          warnings: [],
        },
        {
          applyCategory: true,
          categories: ["Chicken", "Dinner Favorites"],
        }
      ).category
    ).toBe("Chicken")
  })

  it("replaces all supported parsed fields from the same Markdown contract", () => {
    const current = {
      name: "Old Recipe",
      category: "favorites",
      servings: 2,
      prepTimeMinutes: 5,
      cookTimeMinutes: 10,
      totalTimeMinutes: 15,
      tags: ["preserved"],
      ingredients: [{ item: "old ingredient", amount: 1, unit: "cup" }],
      instructionGroups: [{ steps: ["Old step"] }],
      notes: "Old note",
      imageUrl: "https://example.com/preserved.jpg",
    }
    const preview = parseRecipeImportPreview(
      MARKDOWN_SESAME_CHICKEN_RECIPE_TEXT
    )

    expect(preview).not.toBeNull()

    const applied = applyParsedRecipeToFormValues(current, preview!)

    expect(applied).toMatchObject({
      name: "Sesame Chicken",
      category: "favorites",
      servings: 4,
      prepTimeMinutes: 20,
      cookTimeMinutes: 25,
      totalTimeMinutes: 45,
      tags: ["preserved"],
      imageUrl: "https://example.com/preserved.jpg",
    })
    expect(applied.ingredients).toHaveLength(7)
    expect(applied.ingredients.map((ingredient) => ingredient.groupLabel)).toEqual([
      "Chicken",
      "Chicken",
      "Chicken",
      "Sesame Sauce",
      "Sesame Sauce",
      "Sesame Sauce",
      "Sesame Sauce",
    ])
    expect(applied.instructionGroups[0]?.steps).toHaveLength(16)
    expect(applied.notes).toBe(
      "Keep the frying oil close to 350°F.\n" +
      "Sauce the chicken immediately before serving."
    )
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

  it("hydrates imported quantity ranges into the Edit Recipe amount field", () => {
    const parsed = parseRecipeImportPreview(`Honey Mustard Chicken Tenders

Ingredients
1½ lb chicken tenders
2 tbsp olive oil, divided
¼ cup Dijon mustard
2 tbsp honey, divided
1 tbsp lemon juice
½–1 tsp lemon zest
1 tsp garlic powder, divided
1 tsp smoked paprika
¾ tsp kosher salt
½ tsp black pepper
¾ cup panko breadcrumbs
¼ cup grated Parmesan`)

    expect(parsed).not.toBeNull()

    const applied = applyParsedRecipeToFormValues(
      buildNewRecipeDialogFormValues(["dinner"]),
      parsed!
    )

    expect(applied.ingredients).toHaveLength(12)
    expect(applied.ingredients[5]).toMatchObject({
      amount: "0.5–1",
      unit: "tsp",
      item: "lemon zest",
      modifier: undefined,
    })
    expect(applied.ingredients[3]).toMatchObject({
      amount: 2,
      unit: "tbsp",
      item: "honey",
      modifier: "divided",
    })
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
