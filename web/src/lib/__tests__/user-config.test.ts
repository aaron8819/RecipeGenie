import { describe, it, expect } from "vitest"
import { DEFAULT_USER_CONFIG, resolveUserConfig } from "@/lib/user-config"

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
})
