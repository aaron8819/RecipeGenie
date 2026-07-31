import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SortableIngredientList } from "../recipe-sortable-ingredients"
import { parseIngredientLine } from "@/lib/recipe-parser"

describe("SortableIngredientList", () => {
  it("parses a full ingredient line entered into the ingredient field", () => {
    const onIngredientParsed = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[{ item: "", amount: null, unit: "" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
        onIngredientParsed={onIngredientParsed}
      />
    )

    const input = screen.getByPlaceholderText("Ingredient")
    fireEvent.change(input, { target: { value: "1 cup flour, sifted" } })
    fireEvent.blur(input, { target: { value: "1 cup flour, sifted" } })

    expect(onIngredientParsed).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        amount: 1,
        unit: "cup",
        item: "flour",
        modifier: "sifted",
        originalText: "1 cup flour, sifted",
        authoredUnit: "cup",
        quantityV1: expect.objectContaining({
          kind: "exact",
          authored: "1",
          lexeme: "1",
        }),
      })
    )
  })

  it("parses countable whole ingredient lines and exposes the whole/count option", () => {
    const onIngredientParsed = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[{ item: "", amount: null, unit: "" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
        onIngredientParsed={onIngredientParsed}
      />
    )

    expect(screen.getByRole("option", { name: "whole/count" })).toBeInTheDocument()

    const input = screen.getByPlaceholderText("Ingredient")
    fireEvent.change(input, { target: { value: "1 onion, sliced" } })
    fireEvent.blur(input, { target: { value: "1 onion, sliced" } })

    expect(onIngredientParsed).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        amount: 1,
        unit: "count",
        item: "onion",
        modifier: "sliced",
      })
    )
  })

  it("preserves decimal lexemes, package ranges, and qualifiers through the row callback", () => {
    const onIngredientParsed = vi.fn()

    render(
      <SortableIngredientList
        ingredients={[{ item: "", amount: null, unit: "" }]}
        addRecipeModalLayout
        isWideViewport
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={() => {}}
        onIngredientParsed={onIngredientParsed}
      />
    )

    const input = screen.getByPlaceholderText("Ingredient")
    fireEvent.change(input, {
      target: { value: "about 0.50–1 (14 oz) cans tomatoes" },
    })
    fireEvent.blur(input, {
      target: { value: "about 0.50–1 (14 oz) cans tomatoes" },
    })

    expect(onIngredientParsed).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        amount: "0.5–1",
        item: "tomatoes",
        originalText: "about 0.50–1 (14 oz) cans tomatoes",
        quantityV1: expect.objectContaining({
          kind: "range",
          authored: "about 0.50–1",
          qualifier: "about",
          startLexeme: "0.50",
          endLexeme: "1",
        }),
        packageV1: expect.objectContaining({
          type: "can",
          authoredType: "cans",
          count: expect.objectContaining({
            kind: "range",
            qualifier: "about",
          }),
          size: expect.objectContaining({
            lexeme: "14",
            authoredUnit: "oz",
          }),
        }),
      })
    )
  })

  it("keeps an authored decimal in the controlled amount input", () => {
    const onIngredientChange = vi.fn()
    const ingredient = {
      ...parseIngredientLine("0.50 cup sugar"),
      amount: "0.50",
    }

    render(
      <SortableIngredientList
        ingredients={[ingredient]}
        editDocumentLayout
        onReorderIngredients={() => {}}
        onBulkPasteIngredients={() => {}}
        onRemoveIngredient={() => {}}
        onIngredientChange={onIngredientChange}
        onIngredientParsed={() => {}}
      />
    )

    const amount = screen.getByPlaceholderText("Amt")
    expect(amount).toHaveValue("0.50")
    fireEvent.change(amount, { target: { value: "1 1/2" } })
    fireEvent.blur(amount)
    expect(onIngredientChange).toHaveBeenCalledWith(0, "amount", "1 1/2")
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
        onIngredientParsed={() => {}}
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
        onIngredientParsed={() => {}}
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
        onIngredientParsed={() => {}}
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
