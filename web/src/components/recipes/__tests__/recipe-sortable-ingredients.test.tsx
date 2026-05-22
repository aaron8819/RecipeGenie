import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SortableIngredientList } from "../recipe-sortable-ingredients"

describe("SortableIngredientList", () => {
  it("parses a full ingredient line entered into the ingredient field", () => {
    const onIngredientChange = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[{ item: "", amount: null, unit: "" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={onIngredientChange}
      />
    )

    const input = screen.getByPlaceholderText("Ingredient")
    fireEvent.change(input, { target: { value: "1 cup flour, sifted" } })
    fireEvent.blur(input, { target: { value: "1 cup flour, sifted" } })

    expect(onIngredientChange).toHaveBeenCalledWith(0, "amount", 1)
    expect(onIngredientChange).toHaveBeenCalledWith(0, "unit", "cup")
    expect(onIngredientChange).toHaveBeenCalledWith(0, "item", "flour")
    expect(onIngredientChange).toHaveBeenCalledWith(0, "modifier", "sifted")
  })

  it("routes multi-line paste through the bulk paste handler", () => {
    const onBulkPasteIngredients = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[{ item: "", amount: null, unit: "" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={onBulkPasteIngredients}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
      />
    )

    fireEvent.paste(screen.getByPlaceholderText("Ingredient"), {
      clipboardData: {
        getData: () => "1 cup flour\n2 tbsp oil",
      },
    })

    expect(onBulkPasteIngredients).toHaveBeenCalledWith(0, "1 cup flour\n2 tbsp oil")
  })

  it("renders duplicate warnings on highlighted rows", () => {
    render(
      <SortableIngredientList
        ingredients={[{ item: "olive oil", amount: 1, unit: "tbsp" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
        duplicateWarningsByRow={{ 0: ["Possible duplicate of row 2"] }}
      />
    )

    expect(screen.getByText("Possible duplicate of row 2")).toBeInTheDocument()
  })

  it("moves a focused row with arrow keys on the reorder handle", () => {
    const onReorderIngredients = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[
          { item: "flour", amount: 1, unit: "cup" },
          { item: "sugar", amount: 2, unit: "tbsp" },
        ]}
        editDocumentLayout
        onReorderIngredients={onReorderIngredients}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
      />
    )

    fireEvent.keyDown(screen.getByLabelText(/reorder ingredient 1/i), {
      key: "ArrowDown",
    })

    expect(onReorderIngredients).toHaveBeenCalledWith(
      expect.objectContaining({
        active: expect.objectContaining({ id: "0" }),
        over: expect.objectContaining({ id: "1" }),
      })
    )
  })
})
