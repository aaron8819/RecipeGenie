import { describe, expect, it } from "vitest"
import {
  buildPlannerHref,
  parsePlannerWeekParam,
} from "../planner-route-state"

describe("planner route state", () => {
  it("accepts only canonical real calendar dates", () => {
    expect(parsePlannerWeekParam("2026-08-03")).toBe("2026-08-03")
    expect(parsePlannerWeekParam("2026-02-30")).toBeNull()
    expect(parsePlannerWeekParam("08/03/2026")).toBeNull()
    expect(parsePlannerWeekParam(["2026-08-10", "2026-08-17"])).toBe(
      "2026-08-10"
    )
  })

  it("omits the default week and encodes non-default weeks", () => {
    expect(buildPlannerHref("2026-08-03", "2026-08-03")).toBe("/planner")
    expect(buildPlannerHref("2026-08-10", "2026-08-03")).toBe(
      "/planner?week=2026-08-10"
    )
    expect(buildPlannerHref("invalid", "2026-08-03")).toBe("/planner")
  })
})
