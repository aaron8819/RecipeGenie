import { editorIngredientsToIngredientSections } from "@/lib/recipe-structure"
import type {
  Ingredient,
  Recipe,
  RecipeInstructionGroup,
} from "@/types/database"

export type RecipeFixtureInput = Omit<
  Partial<Recipe>,
  "ingredientSections" | "instructionSections"
> & {
  ingredientSections?: Recipe["ingredientSections"]
  instructionSections?: Recipe["instructionSections"]
  fixtureIngredients?: Ingredient[]
  fixtureInstructions?: string[]
  fixtureInstructionGroups?: RecipeInstructionGroup[] | null
}

export function canonicalizeRecipeFixture(
  input: RecipeFixtureInput
): Recipe {
  const {
    ingredientSections,
    instructionSections,
    fixtureIngredients,
    fixtureInstructions,
    fixtureInstructionGroups,
    ...recipe
  } = input

  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "user-1",
    name: "Test Recipe",
    category: "test",
    servings: 4,
    favorite: false,
    tags: [],
    notes: [],
    image_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...recipe,
    ingredientSections:
      ingredientSections ??
      editorIngredientsToIngredientSections(fixtureIngredients ?? []),
    instructionSections:
      instructionSections ??
      (fixtureInstructionGroups
        ? fixtureInstructionGroups.map((group) => ({
            label: group.label?.trim() || null,
            steps: [...group.steps],
          }))
        : fixtureInstructions && fixtureInstructions.length > 0
          ? [{ label: null, steps: fixtureInstructions }]
          : []),
  } as Recipe
}
