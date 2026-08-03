import { describe, expect, it } from "vitest"
import {
  buildRecipeRouteHref,
  parseRecipeRouteState,
} from "../recipe-route-state"

describe("recipe route state", () => {
  it("parses supported search and filter parameters", () => {
    expect(
      parseRecipeRouteState({
        q: " tacos ",
        category: "Dinner",
        tags: ["quick", "family,quick"],
        favorite: "true",
        sort: "name",
        view: "list",
      })
    ).toEqual({
      category: "Dinner",
      favoritesOnly: true,
      query: "tacos",
      sortBy: "name",
      tags: ["quick", "family"],
      viewMode: "list",
    })
  })

  it("falls back safely for invalid values", () => {
    expect(
      parseRecipeRouteState({
        q: "x".repeat(201),
        category: "x".repeat(81),
        favorite: "yes",
        sort: "random",
        view: "cards",
      })
    ).toEqual({
      category: null,
      favoritesOnly: false,
      query: "",
      sortBy: "lastMade",
      tags: [],
      viewMode: null,
    })
  })

  it("omits default values and round-trips meaningful state", () => {
    expect(
      buildRecipeRouteHref(parseRecipeRouteState({}))
    ).toBe("/recipes")

    const state = parseRecipeRouteState({
      q: "soup",
      tags: ["quick", "winter"],
      favorite: "true",
      sort: "newest",
      view: "grid",
    })
    expect(buildRecipeRouteHref(state)).toBe(
      "/recipes?q=soup&tags=quick&tags=winter&favorite=true&sort=newest&view=grid"
    )
  })
})
