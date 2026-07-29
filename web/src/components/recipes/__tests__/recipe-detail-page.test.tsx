import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  RecipeDetailContent,
  scaleIngredientAmount,
} from "../recipe-detail-page"
import type { Recipe } from "@/types/database"

globalThis.React = React

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean
    priority?: boolean
    unoptimized?: boolean
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt || ""} {...props} />
  ),
}))

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Taco Salad",
    category: "dinner",
    servings: 4,
    prep_time_minutes: 15,
    cook_time_minutes: 20,
    total_time_minutes: 35,
    favorite: false,
    tags: ["quick"],
    ingredients: [
      { item: "Lettuce", amount: 1, unit: "whole", groupLabel: "Salad" },
      { item: "Beans", amount: 2, unit: "cup", groupLabel: "Salad" },
      { item: "Lime juice", amount: 2, unit: "tbsp", groupLabel: "Dressing" },
    ],
    instructions: ["Build the salad", "Add the dressing"],
    instruction_groups: [
      { label: "Salad", steps: ["Build the salad"] },
      { label: "Finish", steps: ["Add the dressing"] },
    ],
    notes: ["Keep the dressing separate until serving."],
    image_url: "https://example.com/taco-salad.jpg",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderDetail(recipe = makeRecipe()) {
  const callbacks = {
    onBack: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onFavorite: vi.fn(),
    onMarkMade: vi.fn(),
    onAddToPlan: vi.fn(),
    onAddToShopping: vi.fn(),
    onShare: vi.fn(),
  }

  render(
    <RecipeDetailContent
      recipe={recipe}
      lastMade="2026-07-20T12:00:00.000Z"
      timesMade={3}
      {...callbacks}
    />
  )

  return callbacks
}

describe("RecipeDetailContent", () => {
  it("scales supported single quantities and ranges without floating-point artifacts", () => {
    expect(scaleIngredientAmount("1", 4, 8)).toBe("2")
    expect(scaleIngredientAmount("0.75 cups", 4, 8)).toBe("1½ cups")
    expect(scaleIngredientAmount("1/2 tsp", 4, 8)).toBe("1 tsp")
    expect(scaleIngredientAmount("1 1/2 tbsp", 4, 8)).toBe("3 tbsp")
    expect(scaleIngredientAmount("⅕ cup", 4, 8)).toBe("0.4 cup")
    expect(scaleIngredientAmount("1-2 cloves", 4, 8)).toBe("2-4 cloves")
    expect(scaleIngredientAmount("½–1½ cups", 4, 8)).toBe("1–3 cups")
    expect(scaleIngredientAmount("0.1 cup", 1, 3)).toBe("0.3 cup")
  })

  it("leaves negative, malformed, ambiguous, and nonnumeric quantities unchanged", () => {
    const unsupported = [
      "-1-2",
      "-1",
      "1-2-3",
      "1--2",
      "1 or 2",
      "1-",
      "1 cup ½",
      "add 1 cup",
      "a pinch",
      "well-seasoned",
    ]

    for (const amount of unsupported) {
      expect(scaleIngredientAmount(amount, 4, 8)).toBe(amount)
    }
  })

  it("rejects every supported zero-denominator form without partially scaling ranges", () => {
    const invalid = [
      "1/0",
      "1/00",
      "1 1/00",
      "1/00-2",
      "1-2/00",
      "1/000–2",
    ]

    for (const amount of invalid) {
      expect(scaleIngredientAmount(amount, 4, 8)).toBe(amount)
    }
  })

  it("continues scaling valid fractions neighboring zero-denominator inputs", () => {
    expect(scaleIngredientAmount("1/10", 4, 8)).toBe("0.2")
    expect(scaleIngredientAmount("1 1/10", 4, 8)).toBe("2.2")
    expect(scaleIngredientAmount("1/10-2", 4, 8)).toBe("0.2-4")
  })

  it("does not mutate source recipe, group, or ingredient objects while scaling", () => {
    const ingredient = {
      item: "Stock",
      amount: "about 1 cup",
      unit: "cup",
      groupLabel: "Sauce",
    }
    const group = { label: "Sauce", ingredients: [ingredient] }
    const recipe = makeRecipe({ ingredients: group.ingredients })
    const originalIngredient = structuredClone(ingredient)
    const originalGroup = structuredClone(group)
    const originalRecipe = structuredClone(recipe)

    expect(scaleIngredientAmount(ingredient.amount, 4, 8)).toBe(
      "about 2 cup"
    )
    expect(ingredient).toEqual(originalIngredient)
    expect(group).toEqual(originalGroup)
    expect(recipe).toEqual(originalRecipe)
  })

  it("renders the approved full-page information architecture without checklist UI", () => {
    renderDetail()

    expect(screen.getByTestId("recipe-detail-page")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Taco Salad", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Taco Salad recipe" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /Ingredients/, level: 2 })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Instructions", level: 2 })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Notes", level: 2 })).toBeInTheDocument()

    const sectionNav = screen.getByRole("navigation", { name: "Recipe sections" })
    expect(within(sectionNav).getByRole("link", { name: "Ingredients" })).toHaveAttribute(
      "href",
      "#ingredients"
    )
    expect(within(sectionNav).getByRole("link", { name: "Instructions" })).toHaveAttribute(
      "href",
      "#instructions"
    )
    expect(within(sectionNav).getByRole("link", { name: "Notes" })).toHaveAttribute(
      "href",
      "#notes"
    )
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("updates section anchors without adding a browser history entry", () => {
    renderDetail()
    const historyLength = window.history.length

    fireEvent.click(screen.getByRole("link", { name: "Instructions" }))

    expect(window.location.hash).toBe("#instructions")
    expect(window.history.length).toBe(historyLength)
    window.history.replaceState(window.history.state, "", "/")
  })

  it("renders groups, metadata, instructions, and notes in stored order", () => {
    renderDetail()

    expect(screen.getByText("Prep 15 min")).toBeInTheDocument()
    expect(screen.getByText("Cook 20 min")).toBeInTheDocument()
    expect(screen.getByText("Total 35 min")).toBeInTheDocument()
    expect(screen.getByText("Made 3 times · Last 7/20/2026")).toBeInTheDocument()

    const groupHeadings = screen.getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent)
    expect(groupHeadings).toEqual(["Salad", "Dressing", "Salad", "Finish"])
    expect(screen.getByText("Keep the dressing separate until serving.")).toBeInTheDocument()
    expect(screen.getAllByText("1").length).toBeGreaterThan(0)
    expect(screen.queryByText("1 whole")).not.toBeInTheDocument()
  })

  it("scales numeric quantities locally without mutating stored recipe data", () => {
    const recipe = makeRecipe({
      ingredients: [
        { item: "Stock", amount: "about 0.5–1", unit: "cup" },
        { item: "Spice", amount: "1/2 - 1 1/2", unit: "tsp" },
        { item: "Beans", amount: 2, unit: "cup" },
        { item: "Salt", amount: "to taste", unit: "" },
      ],
    })
    const originalRecipe = structuredClone(recipe)
    renderDetail(recipe)

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Increase servings" }))
    }

    expect(screen.getAllByText("8 servings").length).toBeGreaterThan(0)
    expect(screen.getByText("about 1–2 cup")).toBeInTheDocument()
    expect(screen.getByText("1 - 3 tsp")).toBeInTheDocument()
    expect(screen.getByText("4 cup")).toBeInTheDocument()
    expect(screen.getByText("to taste")).toBeInTheDocument()
    expect(recipe).toEqual(originalRecipe)
  })

  it("scales recognized ranges and preserves unsupported or missing amounts", () => {
    renderDetail(makeRecipe({
      ingredients: [
        { item: "Tomatoes", amount: "2-3", unit: "" },
        { item: "Pepper", amount: "a pinch", unit: "" },
        { item: "Salt", amount: null, unit: "" },
      ],
    }))

    fireEvent.click(screen.getByRole("button", { name: "Increase servings" }))

    expect(screen.getByText("2½-3¾")).toBeInTheDocument()
    expect(screen.getByText("a pinch")).toBeInTheDocument()
    expect(screen.getByText("As needed")).toBeInTheDocument()
    expect(scaleIngredientAmount("0.5-1 tsp", 4, 8)).toBe("1-2 tsp")
    expect(scaleIngredientAmount("½–1½ cups", 4, 8)).toBe("1–3 cups")
    expect(scaleIngredientAmount("a pinch", 4, 8)).toBe("a pinch")
    expect(scaleIngredientAmount("1/0-2", 4, 8)).toBe("1/0-2")
    expect(scaleIngredientAmount(2, 4, 8)).toBe(4)
  })

  it("keeps every supported action accessible from the shared page", () => {
    const callbacks = renderDetail()

    fireEvent.click(screen.getByRole("button", { name: "Mark made" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit Recipe" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to plan" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to Shopping List" }))
    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }))
    fireEvent.click(screen.getByRole("button", { name: "Back to recipes" }))

    expect(callbacks.onMarkMade).toHaveBeenCalledOnce()
    expect(callbacks.onFavorite).toHaveBeenCalledOnce()
    expect(callbacks.onEdit).toHaveBeenCalledOnce()
    expect(callbacks.onAddToPlan).toHaveBeenCalledOnce()
    expect(callbacks.onAddToShopping).toHaveBeenCalledOnce()
    expect(callbacks.onShare).toHaveBeenCalledOnce()
    expect(callbacks.onDelete).toHaveBeenCalledOnce()
    expect(callbacks.onBack).toHaveBeenCalledOnce()
  })

  it("renders safe empty states when optional recipe content is absent", () => {
    renderDetail(makeRecipe({
      image_url: null,
      tags: [],
      prep_time_minutes: null,
      cook_time_minutes: null,
      total_time_minutes: null,
      ingredients: [],
      instructions: [],
      instruction_groups: null,
      notes: [],
    }))

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText("No ingredients available.")).toBeInTheDocument()
    expect(screen.getByText("No instructions available.")).toBeInTheDocument()
    expect(screen.getByText("No notes for this recipe.")).toBeInTheDocument()
  })
})
