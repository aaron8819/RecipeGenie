import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildRecipeDetailHref,
  getRecipeDetailReturnSource,
  normalizeRecipeDetailSource,
  openRecipeDetail,
  returnFromRecipeDetail,
} from "../recipe-detail-navigation"

const router = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}
const originToken = "11111111-1111-4111-8111-111111111111"
const originStorageKey =
  `recipe-genie:recipe-detail-origin:v1:${originToken}`
const homeTabCookie = "recipe-genie-active-tab"

function seedOrigin(origin: unknown) {
  sessionStorage.setItem(originStorageKey, JSON.stringify(origin))
}

function readHomeTabCookie() {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${homeTabCookie}=`))
    ?.split("=")[1]
}

describe("recipe detail navigation", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    document.cookie = `${homeTabCookie}=; Path=/; Max-Age=0`
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"))
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      originToken
    )
  })

  it("uses the same canonical recipe route for every source", () => {
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

  it("records a safe same-session origin and pushes one history entry", () => {
    openRecipeDetail(router, "recipe-1", "planner")

    expect(router.push).toHaveBeenCalledWith(
      "/recipes/recipe-1?from=planner&origin=11111111-1111-4111-8111-111111111111",
      { scroll: false }
    )
    expect(router.replace).not.toHaveBeenCalled()
    expect(localStorage.getItem("recipe-genie-active-tab")).toBe("planner")
  })

  it.each(["recipes", "planner", "shopping"] as const)(
    "accepts independently seeded fresh %s context",
    (source) => {
      seedOrigin({
        createdAt: Date.now() - 1_000,
        recipeId: "recipe-1",
        source,
      })

      expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBe(source)
      returnFromRecipeDetail(router, "recipe-1", originToken)

      expect(router.back).toHaveBeenCalledOnce()
      expect(router.replace).not.toHaveBeenCalled()
    }
  )

  it("accepts context at the inclusive maximum-age boundary", () => {
    seedOrigin({
      createdAt: Date.now() - 24 * 60 * 60 * 1_000,
      recipeId: "recipe-1",
      source: "recipes",
    })

    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBe(
      "recipes"
    )
  })

  it("keeps valid writer-created context available across refreshes", () => {
    openRecipeDetail(router, "recipe-1", "planner")

    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBe("planner")
    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBe("planner")
  })

  it("uses the Recipes fallback for direct URLs without validated context", () => {
    returnFromRecipeDetail(router, "recipe-1", null)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith("/")
    expect(localStorage.getItem("recipe-genie-active-tab")).toBe("recipes")
    expect(readHomeTabCookie()).toBe("recipes")
  })

  it.each(["planner", "shopping"] as const)(
    "replaces a stale %s cookie with Recipes when local storage is unavailable",
    (staleTab) => {
      document.cookie = `${homeTabCookie}=${staleTab}; Path=/`
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage) {
        if (this === localStorage) throw new Error("local storage unavailable")
      })

      expect(() =>
        returnFromRecipeDetail(router, "recipe-1", null)
      ).not.toThrow()

      expect(router.back).not.toHaveBeenCalled()
      expect(router.replace).toHaveBeenCalledWith("/")
      expect(readHomeTabCookie()).toBe("recipes")
    }
  )

  it("falls back to Recipes when session-storage reads and cleanup throw", () => {
    document.cookie = `${homeTabCookie}=planner; Path=/`
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage) {
      if (this === sessionStorage) throw new Error("session storage unavailable")
      return null
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage) {
      if (this === sessionStorage) throw new Error("session storage unavailable")
    })

    expect(() =>
      returnFromRecipeDetail(router, "recipe-1", originToken)
    ).not.toThrow()

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith("/")
    expect(readHomeTabCookie()).toBe("recipes")
  })

  it("keeps known Planner and Shopping origins on browser-history return", () => {
    for (const source of ["planner", "shopping"] as const) {
      seedOrigin({
        createdAt: Date.now(),
        recipeId: "recipe-1",
        source,
      })
      document.cookie = `${homeTabCookie}=${source}; Path=/`

      returnFromRecipeDetail(router, "recipe-1", originToken)

      expect(router.back).toHaveBeenCalled()
      expect(router.replace).not.toHaveBeenCalled()
      expect(readHomeTabCookie()).toBe(source)
      vi.clearAllMocks()
    }
  })

  it.each([
    [
      "stale context",
      () => ({
        createdAt: Date.now() - 24 * 60 * 60 * 1_000 - 1,
        recipeId: "recipe-1",
        source: "recipes",
      }),
    ],
    [
      "future context",
      () => ({
        createdAt: Date.now() + 1,
        recipeId: "recipe-1",
        source: "recipes",
      }),
    ],
    [
      "invalid date text",
      () => ({
        createdAt: "not-a-date",
        recipeId: "recipe-1",
        source: "recipes",
      }),
    ],
    [
      "missing timestamp",
      () => ({ recipeId: "recipe-1", source: "recipes" }),
    ],
    [
      "malformed timestamp representation",
      () => ({
        createdAt: "Infinity",
        recipeId: "recipe-1",
        source: "recipes",
      }),
    ],
    [
      "mismatched recipe ID",
      () => ({
        createdAt: Date.now(),
        recipeId: "recipe-2",
        source: "recipes",
      }),
    ],
    [
      "invalid source",
      () => ({
        createdAt: Date.now(),
        recipeId: "recipe-1",
        source: "pantry",
      }),
    ],
  ])("rejects %s", (_label, createOrigin) => {
    seedOrigin(createOrigin())

    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBeNull()
  })

  it("fails closed for malformed JSON", () => {
    sessionStorage.setItem(originStorageKey, "{malformed")

    expect(() =>
      getRecipeDetailReturnSource("recipe-1", originToken)
    ).not.toThrow()
    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBeNull()
  })

  it("rejects a non-finite numeric timestamp", () => {
    sessionStorage.setItem(
      originStorageKey,
      '{"createdAt":1e309,"recipeId":"recipe-1","source":"recipes"}'
    )

    expect(getRecipeDetailReturnSource("recipe-1", originToken)).toBeNull()
  })

  it("rejects arbitrary source values", () => {
    expect(normalizeRecipeDetailSource("https://example.com")).toBeNull()
    expect(normalizeRecipeDetailSource("pantry")).toBeNull()
    expect(normalizeRecipeDetailSource("planner")).toBe("planner")
  })
})
