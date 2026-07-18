import { describe, expect, it } from "vitest"
import type { Recipe, ShoppingItem } from "@/types/database"
import { parseRecipeText } from "../recipe-parser"
import { generateShoppingList } from "../shopping-list"
import {
  RECIPE_WORKFLOW_FIXTURE_INPUTS,
  RECIPE_WORKFLOW_FIXTURE_VERSION,
} from "./fixtures/recipe-workflow.v1"

function ingredientContract(ingredient: Recipe["ingredients"][number]) {
  return {
    item: ingredient.item,
    amount: ingredient.amount,
    unit: ingredient.unit,
    modifier: ingredient.modifier,
    alternatives: ingredient.alternatives,
    originalText: ingredient.originalText,
  }
}

function shoppingItemContract(item: ShoppingItem) {
  return {
    item: item.item,
    amount: item.amount,
    unit: item.unit,
    additionalAmounts: item.additionalAmounts,
    excludedBy: item.excludedBy,
    sources: item.sources?.map((source) => ({
      recipeId: source.recipeId,
      originalItem: source.originalItem,
      originalAmount: source.originalAmount,
      originalUnit: source.originalUnit,
      prepIntent: source.prepIntent,
    })),
  }
}

describe(`recipe workflow fixture corpus v${RECIPE_WORKFLOW_FIXTURE_VERSION}`, () => {
  it("contains a realistic 20-30 recipe regression corpus", () => {
    expect(RECIPE_WORKFLOW_FIXTURE_INPUTS).toHaveLength(24)
    expect(new Set(RECIPE_WORKFLOW_FIXTURE_INPUTS.map((fixture) => fixture.id)).size).toBe(24)
  })

  it.each(RECIPE_WORKFLOW_FIXTURE_INPUTS)("$id", (fixture) => {
    const parsed = parseRecipeText(fixture.pastedText)
    const recipe = {
      id: fixture.id,
      name: parsed.name,
      servings: parsed.servings ?? 4,
      ingredients: parsed.ingredients,
    } as Recipe
    const shopping = generateShoppingList([recipe], [], [])

    expect({
      fixtureVersion: RECIPE_WORKFLOW_FIXTURE_VERSION,
      covers: fixture.covers,
      parsed: {
        name: parsed.name,
        servings: parsed.servings,
        ingredients: parsed.ingredients.map(ingredientContract),
        instructions: parsed.instructions,
        notes: parsed.notes,
        metadata: parsed.metadata,
        ingredientGroups: parsed.ingredientGroups,
        instructionGroups: parsed.instructionGroups,
        warnings: parsed.warnings,
      },
      shoppingContribution: {
        items: shopping.items.map(shoppingItemContract),
        alreadyHave: shopping.alreadyHave.map(shoppingItemContract),
        excluded: shopping.excluded.map(shoppingItemContract),
        scale: shopping.scale,
        totalServings: shopping.totalServings,
      },
    }).toMatchSnapshot()
  })
})
