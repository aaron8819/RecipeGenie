import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AddRecipeToPlanModal } from "../add-recipe-to-plan-modal"
import type { Recipe } from "@/types/database"
import { canonicalizeRecipeFixture, type RecipeFixtureInput } from "@/test/recipe-fixtures"

globalThis.React = React

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const addToPlanMutateAsync = vi.fn()

let recipes: Recipe[] = []

vi.mock("@/hooks/use-recipes", () => ({
  useRecipes: () => ({
    data: recipes,
  }),
  useCategories: () => ({
    data: ["Dinner", "Lunch"],
  }),
}))

vi.mock("@/hooks/use-planner", () => ({
  useWeeklyPlan: () => ({ data: {
    recipe_ids: ['recipe-1'], day_assignments: { 'recipe-1': 5 },
  } }),
  useAddRecipeToPlan: () => ({
    mutateAsync: addToPlanMutateAsync,
    isPending: false,
  }),
}))

function recipeFixture(overrides: RecipeFixtureInput = {}): Recipe {
  return canonicalizeRecipeFixture({
    id: "recipe-1",
    user_id: "user-1",
    name: "Planner Recipe",
    category: "Dinner",
    servings: 4,
    fixtureIngredients: [],
    fixtureInstructions: [],
    tags: null,
    image_url: null,
    favorite: false,
    created_at: null,
    updated_at: null,
    ...overrides,
  })
}

describe("AddRecipeToPlanModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recipes = [recipeFixture(), recipeFixture({ id: "recipe-2", name: "Second Recipe" })]
  })

  it('shows the selected calendar date and week-wide duplicates without restricting selection', () => {
    render(<AddRecipeToPlanModal open onOpenChange={vi.fn()}
      weekDate="2026-03-09" targetDayIndex={2} weekStartDay={1} />)
    expect(screen.getByText('Choose a recipe for Wednesday, Mar 11, 2026.')).toBeVisible()
    expect(screen.getByText('Already planned this week · Fri, Mar 13')).toBeVisible()
    const planned = screen.getByRole('button', { name: /^Planner Recipe/ })
    expect(planned).toBeEnabled()
    fireEvent.click(planned)
    expect(screen.getByRole('button', { name: 'Add to Plan' })).toBeEnabled()
  })

  it('shows a selected date across a Sunday week and year boundary', () => {
    render(<AddRecipeToPlanModal open onOpenChange={vi.fn()}
      weekDate="2026-12-27" targetDayIndex={5} weekStartDay={0} />)
    expect(screen.getByText('Choose a recipe for Friday, Jan 1, 2027.')).toBeVisible()
  })

  it("keeps the selected recipe and error context visible when adding fails", async () => {
    addToPlanMutateAsync.mockRejectedValueOnce(new Error("Recipe is already in this week's meal plan"))
    const onOpenChange = vi.fn()

    render(
      <AddRecipeToPlanModal
        open
        onOpenChange={onOpenChange}
        weekDate="2026-03-09"
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /^Planner Recipe/ }))
    fireEvent.click(screen.getByRole("button", { name: "Add to Plan" }))

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Recipe is already in this week's meal plan")
    })

    expect(screen.getByRole("button", { name: /^Planner Recipe/ })).toHaveClass("bg-primary/10")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("disables repeat submits and only closes after the mutation really succeeds", async () => {
    const pendingAdd = deferred<unknown>()
    addToPlanMutateAsync.mockReturnValueOnce(pendingAdd.promise)
    const onOpenChange = vi.fn()
    const onAdded = vi.fn()

    render(
      <AddRecipeToPlanModal
        open
        onOpenChange={onOpenChange}
        onAdded={onAdded}
        weekDate="2026-03-09"
        targetDayIndex={2}
        weekStartDay={1}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /^Planner Recipe/ }))

    const submitButton = screen.getByRole("button", { name: "Add to Plan" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Adding..." })).toBeDisabled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Adding..." }))

    expect(addToPlanMutateAsync).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onAdded).not.toHaveBeenCalled()

    await act(async () => {
      pendingAdd.resolve(undefined)
      await pendingAdd.promise
    })

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(onAdded).toHaveBeenCalledTimes(1)

    expect(addToPlanMutateAsync).toHaveBeenCalledWith({
      weekDate: "2026-03-09",
      recipeId: "recipe-1",
      dayOfWeek: 3,
    })
  })
})
