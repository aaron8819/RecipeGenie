import { describe, expect, it } from "vitest"
import {
  convertLegacyRecipeStructure,
  flattenRecipeIngredients,
  flattenRecipeInstructions,
  validateRecipeStructure,
} from "@/lib/recipe-structure"
import { parseIngredientLine } from "@/lib/recipe-parser"
import type {
  Ingredient,
  IngredientSection,
  InstructionSection,
} from "@/types/database"

function ingredient(
  item: string,
  groupLabel?: string
): Ingredient {
  return {
    item,
    amount: 1,
    unit: "cup",
    ...(groupLabel === undefined ? {} : { groupLabel }),
  }
}

function converted(input: Parameters<typeof convertLegacyRecipeStructure>[0]) {
  const result = convertLegacyRecipeStructure(input)
  expect(["success", "equivalent"]).toContain(result.status)
  if (result.status !== "success" && result.status !== "equivalent") {
    throw new Error(`expected conversion success, received ${result.status}`)
  }
  return result
}

describe("canonical recipe structure validation", () => {
  it("accepts ordered ungrouped, labeled, duplicate-label, and empty structures", () => {
    expect(
      validateRecipeStructure({
        ingredientSections: [
          { label: null, ingredients: [ingredient("salt")] },
          { label: "Sauce", ingredients: [ingredient("tomato")] },
          { label: "Sauce", ingredients: [ingredient("basil")] },
        ],
        instructionSections: [
          { label: null, steps: ["Mix."] },
          { label: "Finish", steps: ["Serve."] },
          { label: "Finish", steps: ["Enjoy."] },
        ],
      })
    ).toEqual({ valid: true })
    expect(
      validateRecipeStructure({
        ingredientSections: [],
        instructionSections: [],
      })
    ).toEqual({ valid: true })
  })

  it.each([
    [
      "null ingredient item",
      {
        ingredientSections: [{ label: null, ingredients: [null] }],
        instructionSections: [],
      },
      "invalid-ingredient",
    ],
    [
      "malformed ingredient section",
      {
        ingredientSections: [{ label: null, items: [] }],
        instructionSections: [],
      },
      "invalid-section",
    ],
    [
      "legacy ingredient label",
      {
        ingredientSections: [
          { label: null, ingredients: [ingredient("salt", "Sauce")] },
        ],
        instructionSections: [],
      },
      "invalid-ingredient",
    ],
    [
      "blank canonical label",
      {
        ingredientSections: [{ label: "", ingredients: [ingredient("salt")] }],
        instructionSections: [],
      },
      "invalid-label",
    ],
    [
      "empty persisted section",
      {
        ingredientSections: [{ label: null, ingredients: [] }],
        instructionSections: [],
      },
      "empty-section",
    ],
    [
      "null instruction step",
      {
        ingredientSections: [],
        instructionSections: [{ label: null, steps: [null] }],
      },
      "invalid-step",
    ],
    [
      "malformed instruction section",
      {
        ingredientSections: [],
        instructionSections: [{ label: null, instructions: ["Mix."] }],
      },
      "invalid-section",
    ],
  ])("rejects %s", (_name, structure, code) => {
    expect(validateRecipeStructure(structure)).toMatchObject({
      valid: false,
      issue: { code },
    })
  })
})

describe("legacy ingredient conversion", () => {
  it("converts flat ungrouped ingredients into one section", () => {
    const result = converted({
      ingredients: [ingredient("salt"), ingredient("pepper")],
      instructions: [],
    })
    expect(result.evidence.ingredients).toBe("flat-only")
    expect(result.content.ingredientSections).toEqual([
      {
        label: null,
        ingredients: [ingredient("salt"), ingredient("pepper")],
      },
    ])
  })

  it("builds maximal consecutive label runs without globally merging labels", () => {
    const result = converted({
      ingredients: [
        ingredient("a", " Sauce "),
        ingredient("b", "Sauce"),
        ingredient("c", "Filling"),
        ingredient("d", "Sauce"),
        ingredient("e"),
        ingredient("f", "   "),
      ],
      instructions: [],
    })
    expect(result.content.ingredientSections).toEqual([
      { label: "Sauce", ingredients: [ingredient("a"), ingredient("b")] },
      { label: "Filling", ingredients: [ingredient("c")] },
      { label: "Sauce", ingredients: [ingredient("d")] },
      { label: null, ingredients: [ingredient("e"), ingredient("f")] },
    ])
  })

  it("preserves explicit consecutive equal-label sections", () => {
    const result = converted({
      ingredientGroups: [
        { label: "Sauce", ingredients: [ingredient("a", "ignored")] },
        { label: "Sauce", ingredients: [ingredient("b")] },
      ],
      instructions: [],
    })
    expect(result.evidence.ingredients).toBe("grouped-only")
    expect(result.content.ingredientSections).toEqual([
      { label: "Sauce", ingredients: [ingredient("a")] },
      { label: "Sauce", ingredients: [ingredient("b")] },
    ])
  })

  it("classifies equivalent flat and grouped forms", () => {
    const result = converted({
      ingredients: [ingredient("a", "Sauce"), ingredient("b", "Filling")],
      ingredientGroups: [
        { label: "Sauce", ingredients: [ingredient("a")] },
        { label: "Filling", ingredients: [ingredient("b")] },
      ],
      instructions: [],
    })
    expect(result.status).toBe("equivalent")
    expect(result.evidence.ingredients).toBe("equivalent-dual")
  })

  it("preserves explicit adjacent same-label sections in an equivalent dual form", () => {
    const result = converted({
      ingredients: [ingredient("a", "Sauce"), ingredient("b", "Sauce")],
      ingredientGroups: [
        { label: "Sauce", ingredients: [ingredient("a")] },
        { label: "Sauce", ingredients: [ingredient("b")] },
      ],
      instructions: [],
    })
    expect(result.status).toBe("equivalent")
    expect(result.content.ingredientSections).toEqual([
      { label: "Sauce", ingredients: [ingredient("a")] },
      { label: "Sauce", ingredients: [ingredient("b")] },
    ])
  })

  it("compares every structured ingredient field in dual forms", () => {
    const richIngredient = {
      ...parseIngredientLine("1–2 (14 oz) cans tomatoes"),
      shoppingCategory: "canned",
      modifier: "drained",
      alternatives: ["crushed tomatoes"],
    }
    const equivalent = converted({
      ingredients: [{ ...richIngredient, groupLabel: "Sauce" }],
      ingredientGroups: [{ label: "Sauce", ingredients: [richIngredient] }],
      instructions: [],
    })
    expect(equivalent.status).toBe("equivalent")

    const conflict = convertLegacyRecipeStructure({
      ingredients: [{ ...richIngredient, groupLabel: "Sauce" }],
      ingredientGroups: [{
        label: "Sauce",
        ingredients: [{ ...richIngredient, originalText: "different source text" }],
      }],
      instructions: [],
    })
    expect(conflict).toMatchObject({
      status: "conflict",
      conflicts: [{ field: "ingredients", precedence: "none" }],
    })
  })

  it("fails closed when flat and grouped forms conflict", () => {
    const result = convertLegacyRecipeStructure({
      ingredients: [ingredient("a")],
      ingredientGroups: [{ label: null, ingredients: [ingredient("b")] }],
      instructions: [],
    })
    expect(result).toMatchObject({
      status: "conflict",
      conflicts: [{ field: "ingredients", precedence: "none" }],
      evidence: { ingredients: "conflicting-dual" },
    })
    expect(result).not.toHaveProperty("content")
  })

  it("distinguishes empty arrays from missing or malformed input", () => {
    expect(
      converted({ ingredients: [], instructions: [] }).content.ingredientSections
    ).toEqual([])
    expect(convertLegacyRecipeStructure({ instructions: [] })).toMatchObject({
      status: "malformed",
      issue: { field: "ingredients", code: "invalid-top-level" },
    })
    expect(
      convertLegacyRecipeStructure({ ingredients: null, instructions: [] })
    ).toMatchObject({ status: "malformed" })
    expect(
      convertLegacyRecipeStructure({
        ingredients: null,
        ingredientGroups: [{ label: null, ingredients: [ingredient("salt")] }],
        instructions: [],
      })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "ingredients", code: "invalid-top-level" },
    })
    expect(
      convertLegacyRecipeStructure({ ingredients: {}, instructions: [] })
    ).toMatchObject({ status: "malformed" })
    expect(
      convertLegacyRecipeStructure({ ingredients: [null], instructions: [] })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "ingredients", code: "invalid-ingredient" },
    })
    expect(
      convertLegacyRecipeStructure({
        ingredients: [{ ...ingredient("salt"), unexpected: true }],
        instructions: [],
      })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "ingredients", code: "invalid-ingredient" },
    })
  })

  it("adapts bounded legacy string ingredients", () => {
    const result = converted({ ingredients: ["kosher salt"], instructions: [] })
    expect(result.content.ingredientSections).toEqual([
      {
        label: null,
        ingredients: [
          {
            item: "kosher salt",
            amount: null,
            unit: "",
            originalText: "kosher salt",
          },
        ],
      },
    ])
  })
})

describe("legacy instruction and note conversion", () => {
  it("converts flat instructions and recognized labels in order", () => {
    const result = converted({
      ingredients: [],
      instructions: ["Prep:", " 1. Chop. ", "Cook:", "- Simmer."],
    })
    expect(result.evidence.instructions).toBe("flat-only")
    expect(result.content.instructionSections).toEqual([
      { label: "Prep", steps: ["Chop."] },
      { label: "Cook", steps: ["Simmer."] },
    ])
  })

  it("preserves grouped-only duplicate and consecutive labels", () => {
    const result = converted({
      ingredients: [],
      instructionGroups: [
        { label: "Cook", steps: ["First."] },
        { label: "Cook", steps: ["Second."] },
        { label: "Rest", steps: ["Wait."] },
        { label: "Cook", steps: ["Third."] },
      ],
    })
    expect(result.evidence.instructions).toBe("grouped-only")
    expect(result.content.instructionSections.map((section) => section.label)).toEqual([
      "Cook",
      "Cook",
      "Rest",
      "Cook",
    ])
  })

  it("uses grouped instructions when dual forms are equivalent", () => {
    const result = converted({
      ingredients: [],
      instructions: ["First.", "Second."],
      instructionGroups: [{ label: "Method", steps: ["First.", "Second."] }],
    })
    expect(result.status).toBe("equivalent")
    expect(result.evidence.instructions).toBe("equivalent-dual")
    expect(result.content.instructionSections).toEqual([
      { label: "Method", steps: ["First.", "Second."] },
    ])
  })

  it("classifies conflicting dual instructions and exposes only precedence evidence", () => {
    const result = convertLegacyRecipeStructure({
      ingredients: [],
      instructions: ["Legacy."],
      instructionGroups: [{ label: "Method", steps: ["Current."] }],
    })
    expect(result).toMatchObject({
      status: "conflict",
      conflicts: [{ field: "instructions", precedence: "grouped" }],
      evidence: { instructions: "conflicting-dual" },
    })
    expect(result).not.toHaveProperty("content")
  })

  it("extracts a legacy notes tail only when explicit notes are empty", () => {
    const legacy = converted({
      ingredients: [],
      instructions: ["Mix.", "Notes:", " Keep cold. "],
      notes: [],
    })
    expect(legacy.content.instructionSections).toEqual([
      { label: null, steps: ["Mix."] },
    ])
    expect(legacy.content.notes).toEqual(["Keep cold."])
    expect(legacy.evidence.notes).toBe("legacy-tail")

    const explicit = converted({
      ingredients: [],
      instructions: ["Mix.", "Notes:", "Legacy note."],
      notes: [" Explicit note. "],
    })
    expect(explicit.content.notes).toEqual(["Explicit note."])
    expect(explicit.evidence.notes).toBe("explicit")
  })

  it("drops only specified blank legacy steps and sections", () => {
    const result = converted({
      ingredients: [],
      instructions: ["   "],
      instructionGroups: [
        { label: "Empty", steps: ["  "] },
        { label: " Keep ", steps: [" Step. "] },
      ],
    })
    expect(result.content.instructionSections).toEqual([
      { label: "Keep", steps: ["Step."] },
    ])
  })

  it("distinguishes empty arrays from missing, null-item, and malformed input", () => {
    expect(
      converted({ ingredients: [], instructions: [] }).content.instructionSections
    ).toEqual([])
    expect(convertLegacyRecipeStructure({ ingredients: [] })).toMatchObject({
      status: "malformed",
      issue: { field: "instructions", code: "invalid-top-level" },
    })
    expect(
      convertLegacyRecipeStructure({ ingredients: [], instructions: null })
    ).toMatchObject({ status: "malformed" })
    expect(
      convertLegacyRecipeStructure({
        ingredients: [],
        instructions: null,
        instructionGroups: [{ label: null, steps: ["Grouped."] }],
      })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "instructions", code: "invalid-top-level" },
    })
    expect(
      convertLegacyRecipeStructure({ ingredients: [], instructions: [null] })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "instructions", code: "invalid-step" },
    })
    expect(
      convertLegacyRecipeStructure({
        ingredients: [],
        instructions: [],
        instructionGroups: [{ label: "Bad", steps: null }],
      })
    ).toMatchObject({ status: "malformed" })
    expect(
      convertLegacyRecipeStructure({
        ingredients: [],
        instructions: [],
        notes: [null],
      })
    ).toMatchObject({
      status: "malformed",
      issue: { field: "notes" },
    })
  })
})

describe("canonical boundary flatteners", () => {
  it("preserves section/item order and duplicate labels without mutation", () => {
    const ingredientSections: IngredientSection[] = [
      { label: "Sauce", ingredients: [ingredient("a")] },
      { label: "Sauce", ingredients: [ingredient("b"), ingredient("c")] },
    ]
    const instructionSections: InstructionSection[] = [
      { label: "Cook", steps: ["One."] },
      { label: "Cook", steps: ["Two.", "Three."] },
    ]
    const before = JSON.stringify({ ingredientSections, instructionSections })

    expect(flattenRecipeIngredients(ingredientSections).map((entry) => entry.item)).toEqual([
      "a",
      "b",
      "c",
    ])
    expect(flattenRecipeInstructions(instructionSections)).toEqual([
      "One.",
      "Two.",
      "Three.",
    ])
    expect(JSON.stringify({ ingredientSections, instructionSections })).toBe(before)
    expect(flattenRecipeIngredients([])).toEqual([])
    expect(flattenRecipeInstructions([])).toEqual([])
  })

  it("never mutates converter input", () => {
    const input = {
      ingredients: [ingredient("a", "Sauce"), ingredient("b")],
      instructions: ["Step."],
      notes: ["Note."],
    }
    const before = JSON.stringify(input)
    convertLegacyRecipeStructure(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe("legacy share snapshot structure support", () => {
  it("classifies all four supported flat snapshot structures without identity data", () => {
    const snapshots = Array.from({ length: 4 }, (_value, index) => ({
      ingredients: [ingredient(`ingredient-${index}`)],
      instructions: [`step-${index}`],
      notes: [],
    }))
    const results = snapshots.map((snapshot) =>
      convertLegacyRecipeStructure(snapshot)
    )
    expect(results.map((result) => result.status)).toEqual([
      "success",
      "success",
      "success",
      "success",
    ])
    expect(
      results.every(
        (result) =>
          result.status === "success" &&
          result.evidence.ingredients === "flat-only" &&
          result.evidence.instructions === "flat-only"
      )
    ).toBe(true)
  })
})
