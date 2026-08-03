import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildRecipeDetailHref,
  normalizeRecipeDetailSource,
  openRecipeDetail,
  returnFromRecipeDetail,
} from "../recipe-detail-navigation"

const router = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}

describe("recipe detail navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses one canonical detail route with whitelisted source context", () => {
    expect(buildRecipeDetailHref("recipe 1")).toBe("/recipes/recipe%201")
    expect(buildRecipeDetailHref("recipe-1", "recipes")).toBe(
      "/recipes/recipe-1?from=recipes"
    )
    expect(buildRecipeDetailHref("recipe-1", "planner")).toBe(
      "/recipes/recipe-1?from=planner"
    )
    expect(buildRecipeDetailHref("recipe-1", "shopping")).toBe(
      "/recipes/recipe-1?from=shopping"
    )
  })

  it("pushes a normal history entry without storage or origin tokens", () => {
    openRecipeDetail(router, "recipe-1", "planner")

    expect(router.push).toHaveBeenCalledWith(
      "/recipes/recipe-1?from=planner"
    )
    expect(router.replace).not.toHaveBeenCalled()
  })

  it.each(["recipes", "planner", "shopping"] as const)(
    "returns to a known %s source through browser history",
    (source) => {
      returnFromRecipeDetail(router, source)

      expect(router.back).toHaveBeenCalledOnce()
      expect(router.replace).not.toHaveBeenCalled()
    }
  )

  it("falls back to Recipes for a direct detail URL", () => {
    returnFromRecipeDetail(router, null)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith("/recipes")
  })

  it("rejects arbitrary source values", () => {
    expect(normalizeRecipeDetailSource("https://example.com")).toBeNull()
    expect(normalizeRecipeDetailSource("pantry")).toBeNull()
    expect(normalizeRecipeDetailSource("planner")).toBe("planner")
  })
})
