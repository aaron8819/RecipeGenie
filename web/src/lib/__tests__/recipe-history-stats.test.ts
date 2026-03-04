import { describe, expect, it } from "vitest"
import { getRecipeStatsMap, type RecipeHistoryStatsRow } from "@/lib/recipe-history-stats"

describe("getRecipeStatsMap", () => {
  it("returns an empty map when stats are undefined", () => {
    expect(getRecipeStatsMap(undefined)).toEqual(new Map())
  })

  it("maps aggregated history rows by recipe id", () => {
    const stats: RecipeHistoryStatsRow[] = [
      {
        recipe_id: "recipe-1",
        times_made: 4,
        last_made: "2026-03-01T12:00:00.000Z",
      },
      {
        recipe_id: "recipe-2",
        times_made: 1,
        last_made: "2026-02-14T18:30:00.000Z",
      },
    ]

    const result = getRecipeStatsMap(stats)

    expect(result.get("recipe-1")).toEqual({
      timesMade: 4,
      lastMade: "2026-03-01T12:00:00.000Z",
    })
    expect(result.get("recipe-2")).toEqual({
      timesMade: 1,
      lastMade: "2026-02-14T18:30:00.000Z",
    })
  })
})
