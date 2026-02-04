import { describe, it, expect } from "vitest"
import {
  parseLocalCalendarDate,
  toLocalNoonISOString,
  dayIndexToDayOfWeek,
  dayOfWeekToDayIndex,
  buildUnassignedDayPriority,
  getUnassignedDayOfWeek,
} from "@/lib/planner-utils"

describe("planner-utils", () => {
  it("parses YYYY-MM-DD as a local calendar date", () => {
    const result = parseLocalCalendarDate("2026-02-04")
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(1)
    expect(result!.getDate()).toBe(4)
  })

  it("parses ISO timestamps into local calendar date", () => {
    const result = parseLocalCalendarDate("2026-02-04T23:45:00Z")
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2026)
  })

  it("returns null for invalid date strings", () => {
    expect(parseLocalCalendarDate("not-a-date")).toBeNull()
  })

  it("serializes local noon to ISO", () => {
    const iso = toLocalNoonISOString(new Date(2026, 1, 4))
    const parsed = new Date(iso)
    expect(parsed.getHours()).toBe(12)
  })

  it("converts between week index and day-of-week", () => {
    expect(dayIndexToDayOfWeek(0, 1)).toBe(1)
    expect(dayIndexToDayOfWeek(6, 1)).toBe(0)
    expect(dayOfWeekToDayIndex(1, 1)).toBe(0)
    expect(dayOfWeekToDayIndex(0, 1)).toBe(6)
  })

  it("builds unassigned day priority with preferred and excluded days", () => {
    const priority = buildUnassignedDayPriority([0, 6], [2, 4])
    expect(priority).toEqual([2, 4, 1, 3, 5])
  })

  it("falls back to all days when all are excluded", () => {
    const priority = buildUnassignedDayPriority([0, 1, 2, 3, 4, 5, 6], null)
    expect(priority).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("maps a recipe to a day-of-week using the priority list", () => {
    const priority = [1, 3, 5]
    const day = getUnassignedDayOfWeek("recipe-123", priority)
    expect(priority).toContain(day)
  })
})
