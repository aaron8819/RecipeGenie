import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AddRecipeToPlanModal } from "../add-recipe-to-plan-modal"
import type { Recipe } from "@/types/database"

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
  useAddRecipeToPlan: () => ({
    mutateAsync: addToPlanMutateAsync,
    isPending: false,
  }),
}))

function recipeFixture(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Planner Recipe",
    category: "Dinner",
    servings: 4,
    ingredients: [],
    instructions: [],
    tags: null,
    image_url: null,
    favorite: false,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe("AddRecipeToPlanModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recipes = [recipeFixture(), recipeFixture({ id: "recipe-2", name: "Second Recipe" })]
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

    render(
      <AddRecipeToPlanModal
        open
        onOpenChange={onOpenChange}
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

    await act(async () => {
      pendingAdd.resolve(undefined)
      await pendingAdd.promise
    })

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    expect(addToPlanMutateAsync).toHaveBeenCalledWith({
      weekDate: "2026-03-09",
      recipeId: "recipe-1",
      dayOfWeek: 3,
    })
  })
})
