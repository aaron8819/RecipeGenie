import { describe, expect, it } from "vitest"
import {
  assertRecipeUuid,
  mapPlanTemplateRow,
  mapRecipeRow,
  mapShoppingItems,
  mapWeeklyPlanRow,
  recipeUuidWrite,
  type RecipeRow,
} from "@/lib/recipe-identity"

const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"

function recipeRow(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: "legacy-alias",
    recipe_uuid: UUID_A,
    user_id: "owner",
    name: "Same Name",
    category: "test",
    servings: 4,
    favorite: false,
    tags: [],
    ingredient_sections: [],
    instruction_sections: [],
    yield_metadata: null,
    image_url: null,
    notes: [],
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe("recipe application identity mapping", () => {
  it("maps recipe_uuid to Recipe.id and legacy id only to legacyId", () => {
    const recipe = mapRecipeRow(recipeRow())
    expect(recipe.id).toBe(UUID_A)
    expect(recipe.legacyId).toBe("legacy-alias")
    expect(recipe.id).not.toBe(recipe.legacyId)
  })

  it("keeps duplicate names independent and rename-stable", () => {
    const first = mapRecipeRow(recipeRow())
    const second = mapRecipeRow(recipeRow({ id: "other-alias", recipe_uuid: UUID_B }))
    const renamed = mapRecipeRow(recipeRow({ name: "Renamed ! café" }))
    expect(first.name).toBe(second.name)
    expect(first.id).not.toBe(second.id)
    expect(renamed.id).toBe(first.id)
  })

  it("writes the canonical UUID as an opaque removable compatibility alias", () => {
    expect(recipeUuidWrite(UUID_A)).toEqual({ id: UUID_A, recipe_uuid: UUID_A })
  })

  it("rejects malformed application recipe identity", () => {
    expect(() => assertRecipeUuid("same-name-slug")).toThrow("must be a UUID")
  })

  it("maps planner and template UUID fields without changing order or assignments", () => {
    const plan = mapWeeklyPlanRow({
      user_id: "owner",
      week_date: "2026-07-20",
      recipe_ids: ["legacy-b", "legacy-a"],
      recipe_uuids: [UUID_B, UUID_A],
      day_assignments: { "legacy-a": 1 },
      day_assignment_recipe_uuids: { [UUID_A]: { day: 1 } },
      made_recipe_ids: ["legacy-a"],
      made_recipe_uuids: [UUID_A],
      scale: 1,
      generated_at: "2026-07-17T00:00:00Z",
    })
    expect(plan.recipe_ids).toEqual([UUID_B, UUID_A])
    expect(plan.day_assignments).toEqual({ [UUID_A]: { day: 1 } })
    expect(plan.made_recipe_ids).toEqual([UUID_A])

    const template = mapPlanTemplateRow({
      id: "template",
      user_id: "owner",
      name: "same names",
      recipe_ids: ["legacy-a", "legacy-b"],
      recipe_uuids: [UUID_A, UUID_B],
      day_assignments: { "legacy-b": 6 },
      day_assignment_recipe_uuids: { [UUID_B]: 6 },
      category_selection: null,
      created_at: "2026-07-17T00:00:00Z",
      updated_at: "2026-07-17T00:00:00Z",
    })
    expect(template.recipe_ids).toEqual([UUID_A, UUID_B])
    expect(template.day_assignments).toEqual({ [UUID_B]: 6 })
  })

  it("maps shopping provenance UUIDs while preserving unresolved legacy evidence", () => {
    const [active, historical] = mapShoppingItems([
      {
        item: "active",
        amount: 1,
        unit: "cup",
        categoryKey: "test",
        categoryOrder: 1,
        sources: [{
          recipeId: "legacy-active",
          recipeName: "Display",
          recipeUuid: UUID_A,
        } as never],
      },
      {
        item: "historical",
        amount: 1,
        unit: "cup",
        categoryKey: "test",
        categoryOrder: 1,
        sources: [{ recipeId: "deleted-legacy", recipeName: "Snapshot" }],
      },
    ])
    expect(active.sources?.[0]).toMatchObject({
      recipeId: UUID_A,
      legacyRecipeId: "legacy-active",
      recipeName: "Display",
    })
    expect(historical.sources?.[0]).toMatchObject({
      legacyRecipeId: "deleted-legacy",
      recipeName: "Snapshot",
    })
    expect(historical.sources?.[0].recipeId).toBeUndefined()
  })
})
