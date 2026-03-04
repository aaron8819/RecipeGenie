import { describe, expect, it } from "vitest"
import {
  getRecipeHistoryQueryKey,
  getRecentRecipeHistoryQueryKey,
  getRecipeHistoryStatsQueryKey,
} from "@/hooks/use-planner"

describe("history query keys", () => {
  it("keeps full, recent, and stats history caches distinct", () => {
    expect(getRecipeHistoryQueryKey()).toEqual(["recipe_history"])
    expect(getRecipeHistoryStatsQueryKey()).toEqual(["recipe_history", "stats"])
    expect(getRecentRecipeHistoryQueryKey(7)).toEqual(["recipe_history", "recent", 7])
  })

  it("varies recent-history cache keys by exclusion window", () => {
    expect(getRecentRecipeHistoryQueryKey(7)).not.toEqual(getRecentRecipeHistoryQueryKey(14))
  })
})
