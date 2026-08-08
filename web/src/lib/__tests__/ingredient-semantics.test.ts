import { describe, expect, it } from "vitest"
import type { PantryItem } from "@/types/database"
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
  type ShoppingDocumentV2,
  type ShoppingRecipeIngredientV1,
} from "../shopping-document"
import {
  resolveShoppingIngredient,
  type ResolvedShoppingIngredient,
} from "../shopping-ingredient-resolution"
import { parseIngredientLine } from "../recipe-parser"
import { INGREDIENT_EXCLUSION_REASONS } from "../ingredient-exclusion-families"
import { INGREDIENT_SEMANTIC_FIXTURES } from "./fixtures/ingredient-semantics"

function resolveFixture(line: string): ResolvedShoppingIngredient {
  return resolveShoppingIngredient({
    ingredient: parseIngredientLine(line),
    recipeId: "fixture-recipe",
  })
}

function persistedIngredient(
  resolved: ResolvedShoppingIngredient
): ShoppingRecipeIngredientV1 {
  return {
    ingredientKey: resolved.ingredientKey,
    aggregateKey: resolved.aggregateKey,
    displayName: resolved.displayName,
    quantity: resolved.quantity,
    purchaseUnit: resolved.purchaseUnit,
    defaultCategoryKey: resolved.defaultCategoryKey,
    pantryMatchKeys: resolved.pantryMatchKeys,
    exclusionFamily: resolved.exclusionFamily,
    citrusPrep: resolved.citrusPrep,
  }
}

function documentFor(resolved: ResolvedShoppingIngredient): ShoppingDocumentV2 {
  const document = createEmptyShoppingDocument()
  document.recipeEntries["fixture-recipe"] = {
    recipeId: "fixture-recipe",
    recipeName: "Fixture recipe",
    selectedServings: 1,
    scaleV1: { numerator: "1", denominator: "1" },
    ingredients: [persistedIngredient(resolved)],
  }
  return document
}

function pantryItem(item: string): PantryItem {
  return { item } as PantryItem
}

describe("ingredient semantic consumer matrix", () => {
  it.each(INGREDIENT_SEMANTIC_FIXTURES)(
    "keeps resolver, Shopping, exclusion, and category meaning for $line",
    (fixture) => {
      const first = resolveFixture(fixture.line)
      const second = resolveFixture(fixture.line)

      expect(first).toMatchObject({
        ingredientKey: fixture.ingredientKey,
        aggregateKey: JSON.stringify(
          ["shopping-aggregate", 1, fixture.aggregateIdentity]
        ),
        pantryMatchKeys: fixture.pantryMatchKeys,
        exclusionFamily: fixture.exclusionFamily,
        defaultCategoryKey: fixture.defaultCategoryKey,
      })
      expect(second.pantryMatchKeys).toEqual(first.pantryMatchKeys)

      const document = documentFor(first)
      if (fixture.exclusionFamily === "salt") {
        document.preferences.excludeSaltVariants = true
      } else if (fixture.exclusionFamily === "black-pepper") {
        document.preferences.excludeBlackPepperVariants = true
      }

      const projection = projectShoppingDocument(document)
      if (fixture.exclusionFamily) {
        expect(projection.excluded[0].excludedBy).toBe(
          INGREDIENT_EXCLUSION_REASONS[fixture.exclusionFamily]
        )
      } else {
        expect(projection.items).toHaveLength(1)
      }
      expect(projection.rows[0].categoryKey).toBe(fixture.defaultCategoryKey)
    }
  )

  it.each(
    INGREDIENT_SEMANTIC_FIXTURES.flatMap((fixture) =>
      fixture.pantryMatches.map((pantry) => ({ fixture, pantry }))
    )
  )("lets Pantry $pantry satisfy $fixture.line", ({ fixture, pantry }) => {
    const projection = projectShoppingDocument(
      documentFor(resolveFixture(fixture.line)),
      [pantryItem(pantry)]
    )

    expect(projection.alreadyHave).toHaveLength(1)
    expect(projection.items).toHaveLength(0)
  })

  it.each(
    INGREDIENT_SEMANTIC_FIXTURES.flatMap((fixture) =>
      fixture.pantryMisses.map((pantry) => ({ fixture, pantry }))
    )
  )("does not let Pantry $pantry satisfy $fixture.line", ({ fixture, pantry }) => {
    const projection = projectShoppingDocument(
      documentFor(resolveFixture(fixture.line)),
      [pantryItem(pantry)]
    )

    expect(projection.alreadyHave).toHaveLength(0)
    expect(projection.items).toHaveLength(1)
  })
})
