import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import RecipePage from "./page"

globalThis.React = React

vi.mock("@/components/recipes/recipe-detail-page", () => ({
  RecipeDetailPage: ({
    recipeId,
    originToken,
  }: {
    recipeId: string
    originToken?: string
  }) => (
    <div
      data-testid="recipe-route"
      data-recipe-id={recipeId}
      data-origin={originToken}
    />
  ),
}))

describe("/recipes/[id]", () => {
  it("renders direct recipe URLs without requiring origin state", async () => {
    const page = await RecipePage({
      params: Promise.resolve({ id: "recipe-1" }),
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByTestId("recipe-route")).toHaveAttribute(
      "data-recipe-id",
      "recipe-1"
    )
    expect(screen.getByTestId("recipe-route")).not.toHaveAttribute("data-origin")
  })

  it("passes only the opaque origin token to the shared detail page", async () => {
    const page = await RecipePage({
      params: Promise.resolve({ id: "recipe-1" }),
      searchParams: Promise.resolve({
        from: "planner",
        origin: "origin-token",
      }),
    })

    render(page)

    expect(screen.getByTestId("recipe-route")).toHaveAttribute(
      "data-origin",
      "origin-token"
    )
  })
})
