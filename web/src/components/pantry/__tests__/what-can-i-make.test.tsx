import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WhatCanIMake } from "@/components/pantry/what-can-i-make"

const mutateAsync = vi.fn()
const showToast = vi.fn()

vi.mock("@/hooks/use-pantry-match", () => ({
  usePantryMatch: () => ({
    matches: [
      {
        recipe: {
          id: "recipe-1",
          name: "Garlic Pasta",
          category: "vegetarian",
        },
        matchedIngredients: ["garlic"],
        missingIngredients: [{ item: "pasta", amount: 1, unit: "lb" }],
        matchPercentage: 50,
        totalIngredients: 2,
      },
    ],
    isLoading: false,
  }),
}))

vi.mock("@/hooks/use-pantry", () => ({
  usePantryItems: () => ({
    data: [{ id: "pantry-1", item: "garlic" }],
  }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useAddPantryRecipeToShoppingList: () => ({
    mutateAsync,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: showToast,
  }),
}))

describe("WhatCanIMake", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses the explicit shopping-owned Pantry intent and matching action copy", async () => {
    mutateAsync.mockResolvedValueOnce({
      added: 1,
      merged: 0,
    })

    render(<WhatCanIMake open={true} onOpenChange={() => {}} />)

    expect(
      screen.getByText(
        /see what you can make now and add any missing shopping items from a recipe/i
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /add ingredients to shopping list/i }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith("recipe-1")
    })
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Added 1 shopping item from "Garlic Pasta" to shopping list',
      })
    )
  })
})
