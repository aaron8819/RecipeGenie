import { describe, it, expect } from "vitest"
import { DEFAULT_RECIPE_CATEGORIES, DEFAULT_RECIPE_SELECTION, DEFAULT_USER_CONFIG, resolveUserConfig } from "@/lib/user-config"

describe("user-config", () => {
  it("returns defaults when config row is missing", () => {
    const config = resolveUserConfig(null, { code: "PGRST116" })
    expect(config).toEqual(DEFAULT_USER_CONFIG)
  })

  it("throws for unexpected errors", () => {
    expect(() => resolveUserConfig(null, { code: "PGRST999" })).toThrow()
  })

  it("returns data when no error is present", () => {
    const config = resolveUserConfig(
      { ...DEFAULT_USER_CONFIG, week_start_day: 0 },
      null
    )
    expect(config.week_start_day).toBe(0)
  })

  it("uses canonical beef defaults and no legacy steak defaults", () => {
    expect(DEFAULT_RECIPE_CATEGORIES).toContain("beef")
    expect(DEFAULT_RECIPE_CATEGORIES).not.toContain("steak")
    expect(DEFAULT_RECIPE_SELECTION.beef).toBe(1)
    expect(DEFAULT_RECIPE_SELECTION.steak).toBeUndefined()
    expect(DEFAULT_USER_CONFIG.categories).toEqual(DEFAULT_RECIPE_CATEGORIES)
    expect(DEFAULT_USER_CONFIG.default_selection).toEqual(DEFAULT_RECIPE_SELECTION)
  })
})
