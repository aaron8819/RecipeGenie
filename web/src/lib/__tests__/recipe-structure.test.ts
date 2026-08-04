import { describe, expect, it } from "vitest"
import {
  editorGroupsToInstructionSections,
  editorIngredientsToIngredientSections,
  flattenRecipeIngredients,
  flattenRecipeInstructions,
  ingredientSectionsToEditorIngredients,
  instructionSectionsToEditorGroups,
  validateRecipeStructure,
} from "@/lib/recipe-structure"
import type {
  CanonicalIngredient,
  IngredientSection,
  InstructionSection,
} from "@/types/database"

function ingredient(item: string): CanonicalIngredient {
  return { item, amount: 1, unit: "cup" }
}

describe("canonical recipe structure", () => {
  it("accepts ordered canonical sections and top-level empty arrays", () => {
    expect(
      validateRecipeStructure({
        ingredientSections: [
          { label: null, ingredients: [ingredient("salt")] },
          { label: "Sauce", ingredients: [ingredient("tomato")] },
          { label: "Sauce", ingredients: [ingredient("basil")] },
        ],
        instructionSections: [
          { label: "Prep", steps: ["Chop."] },
          { label: null, steps: ["Cook."] },
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
      "missing ingredient sections",
      { instructionSections: [] },
      { field: "ingredientSections", code: "invalid-top-level" },
    ],
    [
      "null ingredient",
      {
        ingredientSections: [{ label: null, ingredients: [null] }],
        instructionSections: [],
      },
      { field: "ingredientSections", code: "invalid-ingredient" },
    ],
    [
      "legacy ingredient label",
      {
        ingredientSections: [
          {
            label: null,
            ingredients: [{ ...ingredient("salt"), groupLabel: "Sauce" }],
          },
        ],
        instructionSections: [],
      },
      { field: "ingredientSections", code: "invalid-ingredient" },
    ],
    [
      "blank section label",
      {
        ingredientSections: [{ label: "", ingredients: [ingredient("salt")] }],
        instructionSections: [],
      },
      { field: "ingredientSections", code: "invalid-label" },
    ],
    [
      "empty ingredient section",
      {
        ingredientSections: [{ label: null, ingredients: [] }],
        instructionSections: [],
      },
      { field: "ingredientSections", code: "empty-section" },
    ],
    [
      "blank instruction",
      {
        ingredientSections: [],
        instructionSections: [{ label: null, steps: [""] }],
      },
      { field: "instructionSections", code: "invalid-step" },
    ],
    [
      "legacy instruction key",
      {
        ingredientSections: [],
        instructionSections: [{ label: null, instructions: ["Mix."] }],
      },
      { field: "instructionSections", code: "invalid-section" },
    ],
  ])("rejects %s", (_name, input, issue) => {
    expect(validateRecipeStructure(input)).toEqual({ valid: false, issue })
  })
})

describe("explicit recipe structure boundaries", () => {
  const ingredientSections: IngredientSection[] = [
    { label: "Sauce", ingredients: [ingredient("a")] },
    { label: "Sauce", ingredients: [ingredient("b"), ingredient("c")] },
    { label: null, ingredients: [ingredient("d")] },
  ]
  const instructionSections: InstructionSection[] = [
    { label: "Prep", steps: ["First.", "Second."] },
    { label: null, steps: ["Third."] },
  ]

  it("flattens canonical sections only at ingredient and instruction boundaries", () => {
    expect(flattenRecipeIngredients(ingredientSections).map(({ item }) => item))
      .toEqual(["a", "b", "c", "d"])
    expect(flattenRecipeInstructions(instructionSections))
      .toEqual(["First.", "Second.", "Third."])
  })

  it("preserves editor item order and consecutive label runs", () => {
    const editorIngredients = ingredientSectionsToEditorIngredients(
      ingredientSections
    )
    expect(editorIngredients.map(({ groupLabel }) => groupLabel ?? null))
      .toEqual(["Sauce", "Sauce", "Sauce", null])
    expect(editorIngredientsToIngredientSections(editorIngredients)).toEqual([
      {
        label: "Sauce",
        ingredients: [ingredient("a"), ingredient("b"), ingredient("c")],
      },
      { label: null, ingredients: [ingredient("d")] },
    ])

    expect(
      editorGroupsToInstructionSections(
        instructionSectionsToEditorGroups(instructionSections)
      )
    ).toEqual(instructionSections)
  })
})
