import { describe, expect, it } from "vitest"
import type { RecipeUpdate } from "@/types/database"
import { normalizeRecipeUpdates } from "@/hooks/use-recipes"

describe("normalizeRecipeUpdates", () => {
  it("does not add tags when omitted", () => {
    const updates: RecipeUpdate = { name: "Updated" }
    const normalized = normalizeRecipeUpdates(updates)

    expect(Object.prototype.hasOwnProperty.call(normalized, "tags")).toBe(false)
  })

  it("preserves provided tags", () => {
    const updates: RecipeUpdate = { tags: ["quick", "dinner"] }
    const normalized = normalizeRecipeUpdates(updates)

    expect(normalized.tags).toEqual(["quick", "dinner"])
  })

  it("coerces null tags to empty array", () => {
    const updates = { tags: null } as unknown as RecipeUpdate
    const normalized = normalizeRecipeUpdates(updates)

    expect(normalized.tags).toEqual([])
  })
})
