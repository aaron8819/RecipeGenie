import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import RecipePage from "./page"

globalThis.React = React

vi.mock("@/components/recipes/recipe-detail-page", () => ({
  RecipeDetailPage: ({
    recipeId,
    returnSource,
  }: {
    recipeId: string
    returnSource?: string | null
  }) => (
    <div
      data-testid="recipe-route"
      data-recipe-id={recipeId}
      data-source={returnSource ?? undefined}
    />
  ),
}))

describe("/recipes/[id]", () => {
  it("renders direct recipe URLs with the Recipes fallback", async () => {
    const page = await RecipePage({
      params: Promise.resolve({ id: "recipe-1" }),
      searchParams: Promise.resolve({}),
    })

    render(page)
    expect(screen.getByTestId("recipe-route")).toHaveAttribute(
      "data-recipe-id",
      "recipe-1"
    )
    expect(screen.getByTestId("recipe-route")).not.toHaveAttribute(
      "data-source"
    )
  })

  it("passes only a whitelisted source to the detail page", async () => {
    const plannerPage = await RecipePage({
      params: Promise.resolve({ id: "recipe-1" }),
      searchParams: Promise.resolve({ from: "planner" }),
    })
    const invalidPage = await RecipePage({
      params: Promise.resolve({ id: "recipe-2" }),
      searchParams: Promise.resolve({ from: "pantry" }),
    })

    const { rerender } = render(plannerPage)
    expect(screen.getByTestId("recipe-route")).toHaveAttribute(
      "data-source",
      "planner"
    )
    rerender(invalidPage)
    expect(screen.getByTestId("recipe-route")).not.toHaveAttribute(
      "data-source"
    )
  })
})
