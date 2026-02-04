import { describe, it, expect } from "vitest"
import { getCategoryHexColor } from "@/lib/planner-colors"

describe("planner-colors", () => {
  it("returns known colors for categories", () => {
    expect(getCategoryHexColor("chicken")).toBe("#4d7c0f")
    expect(getCategoryHexColor("BEEF")).toBe("#b91c1c")
  })

  it("falls back to gray for unknown categories", () => {
    expect(getCategoryHexColor("unknown")).toBe("#6b7280")
  })
})
