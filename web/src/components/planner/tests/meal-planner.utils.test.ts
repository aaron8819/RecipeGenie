import { describe, expect, it } from "vitest"
import {
  getDayOfWeekForWeekIndex,
  getWeekDayIndexForDate,
  getWeekDays,
  getWeekStartDate,
  navigateWeek,
} from "../meal-planner.utils"

describe("meal-planner.utils", () => {
  it("calculates week start for Monday-based weeks", () => {
    const weekStart = getWeekStartDate(new Date(2026, 0, 8), 1) // Thu Jan 8 2026
    expect(weekStart).toBe("2026-01-05")
  })

  it("shifts to previous and next week by 7 days", () => {
    expect(navigateWeek("2026-01-05", "next")).toBe("2026-01-12")
    expect(navigateWeek("2026-01-05", "prev")).toBe("2025-12-29")
  })

  it("maps week day indices to day-of-week and back to index", () => {
    const weekDays = getWeekDays("2026-01-05")
    expect(getDayOfWeekForWeekIndex(weekDays, 0)).toBe(1) // Monday
    expect(getDayOfWeekForWeekIndex(weekDays, 6)).toBe(0) // Sunday
    expect(getWeekDayIndexForDate(weekDays, new Date(2026, 0, 7))).toBe(2) // Wednesday
  })
})
