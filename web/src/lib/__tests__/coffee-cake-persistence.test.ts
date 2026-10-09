import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseRecipeText } from "../recipe-parser"
import { requireIngredientsForPersistence, normalizeRecipeShareSnapshot } from "../recipe-data-validation"

const source = readFileSync("src/lib/__tests__/fixtures/coffee-cake.txt", "utf8")
const sourceLine = "- Source: https://sallysbakingaddiction.com/coffee-cake-recipe/"

describe("coffee cake replacement persistence", () => {
  it("preserves the revised paste with hard breaks, bold steps and a Markdown source link", () => {
    const text = readFileSync("src/lib/__tests__/fixtures/coffee-cake-revised.txt", "utf8")
    const parsed = parseRecipeText(text)
    expect(parsed.unparsedContent).toEqual([])
    expect(parsed.servings).toBe(9)
    expect(parsed.metadata).toMatchObject({ prepTimeMinutes: 20, cookTimeMinutes: 40 })
    expect(parsed.ingredientSections.map(section => section.label)).toEqual(["Cinnamon Streusel", "Cake"])
    expect(parsed.ingredientSections.map(section => section.ingredients.length)).toEqual([4, 10])
    const authoredIngredients = text.split("## Ingredients")[1].split("## Instructions")[0]
      .split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2))
    expect(parsed.ingredientSections.flatMap(section => section.ingredients.map(ingredient => ingredient.originalText)))
      .toEqual(authoredIngredients)
    const authoredSteps = text.split("## Instructions")[1].split("## Notes")[0]
      .split("\n").filter(line => /^\d+\. /.test(line))
      .map(line => line.replace(/^\d+\. /, "").replace(/\*\*([^*]+)\*\*/g, "$1"))
    expect(parsed.instructionSections.flatMap(section => section.steps)).toEqual(authoredSteps)
    const authoredNotes = text.split("## Notes")[1].split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2))
    expect(parsed.notes).toEqual(authoredNotes)
    expect(normalizeRecipeShareSnapshot({
      name: parsed.name, category: "Dessert", servings: parsed.servings, tags: [],
      ingredient_sections: parsed.ingredientSections, instruction_sections: parsed.instructionSections,
      notes: parsed.notes, yield_metadata: parsed.yieldMetadata,
    }, "persist")).not.toBeNull()
  })

  it.each([true, false])("preserves the exact paste with Source URL present=%s", (includeSource) => {
    const text = includeSource ? source : source.replace(sourceLine + "\n", "")
    const parsed = parseRecipeText(text)
    expect(parsed.unparsedContent).toEqual([])
    expect(parsed.warnings).toEqual([])
    expect(parsed.ingredientSections.map(section => section.label)).toEqual(["Cinnamon Streusel", "Cake"])
    expect(parsed.ingredientSections.map(section => section.ingredients.length)).toEqual([4, 10])
    const authoredIngredients = text.split("## Ingredients")[1].split("## Instructions")[0]
      .split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2))
    expect(parsed.ingredientSections.flatMap(section => section.ingredients.map(ingredient => ingredient.originalText)))
      .toEqual(authoredIngredients)
    const authoredSteps = text.split("## Instructions")[1].split("## Notes")[0]
      .split("\n").filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ""))
    expect(parsed.instructionSections.flatMap(section => section.steps)).toEqual(authoredSteps)
    const authoredNotes = text.split("## Notes")[1].split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2))
    expect(parsed.notes).toEqual(authoredNotes)
    for (const section of parsed.ingredientSections) {
      expect(requireIngredientsForPersistence(section.ingredients)).toEqual(section.ingredients)
    }
    const snapshot = normalizeRecipeShareSnapshot({
      name: parsed.name, category: "Dessert", servings: parsed.servings, tags: [],
      ingredient_sections: parsed.ingredientSections, instruction_sections: parsed.instructionSections,
      notes: parsed.notes, yield_metadata: parsed.yieldMetadata,
    }, "persist")
    expect(snapshot).not.toBeNull()
    expect(snapshot?.notes).toEqual(authoredNotes)
    expect(parsed.ingredientSections[1].ingredients[0].quantityV1).toMatchObject({
      kind: "exact", authored: "1 1/3", lexeme: "1 1/3",
      value: { numerator: "4", denominator: "3" },
    })
  })

  it("the Source URL changes only Notes", () => {
    const withSource = parseRecipeText(source)
    const withoutSource = parseRecipeText(source.replace(sourceLine + "\n", ""))
    expect({ ...withSource, notes: [] }).toEqual({ ...withoutSource, notes: [] })
    expect(withSource.notes).toContain(sourceLine.slice(2))
  })
})
