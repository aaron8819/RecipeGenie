import { describe, it, expect } from "vitest"
import { autoAssignDays } from "@/lib/meal-planner"

describe("autoAssignDays", () => {
  it("drops assignments for recipes not in the plan", () => {
    const assignments = autoAssignDays(
      ["a", "b"],
      [],
      null,
      { a: 1, c: 4 }
    )
    expect(assignments).toEqual({ a: 1, b: assignments.b })
    expect(assignments).not.toHaveProperty("c")
  })

  it("preserves existing assignments and assigns remaining recipes", () => {
    const assignments = autoAssignDays(["a", "b", "c"], [], null, { b: 2 })
    expect(assignments.b).toBe(2)
    expect(assignments).toHaveProperty("a")
    expect(assignments).toHaveProperty("c")
  })

  it("respects excluded days when assigning", () => {
    const assignments = autoAssignDays(["a", "b", "c"], [1, 3], null, {})
    expect(Object.values(assignments)).not.toContain(1)
    expect(Object.values(assignments)).not.toContain(3)
  })
})
