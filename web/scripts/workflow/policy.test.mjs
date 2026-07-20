import { describe, expect, it } from "vitest"
import { resolveWorkflowTier, tierForOperation } from "./policy.mjs"

describe("workflow risk policy", () => {
  it("assigns the documented minimum operation tiers", () => {
    expect(tierForOperation("local-verification")).toBe(1)
    expect(tierForOperation("migration-application")).toBe(2)
  })

  it("may escalate but never silently downgrades an explicit tier", () => {
    expect(resolveWorkflowTier({ selectedTier: 1, recommendedTier: 3 })).toBe(3)
    expect(resolveWorkflowTier({ selectedTier: 3, recommendedTier: 1 })).toBe(3)
    expect(() => resolveWorkflowTier({ selectedTier: 0, recommendedTier: 1 })).toThrow(/1, 2, or 3/)
  })
})
