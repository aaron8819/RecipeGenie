import { describe, expect, it } from "vitest"
import {
  formatShoppingAddMessage,
  isAlreadyInShoppingListError,
} from "@/lib/shopping-feedback"

describe("formatShoppingAddMessage", () => {
  const itemLabel = {
    singular: "shopping item",
    plural: "shopping items",
  }

  it("describes added and updated results together", () => {
    expect(
      formatShoppingAddMessage(
        { added: 2, merged: 1 },
        { sourceName: "Pasta", itemLabel }
      )
    ).toBe('Added 2 shopping items from "Pasta" to shopping list; updated 1 shopping item already there')
  })

  it("describes update-only results without claiming new additions", () => {
    expect(
      formatShoppingAddMessage(
        { added: 0, merged: 2 },
        { sourceName: "Pasta", itemLabel }
      )
    ).toBe('Updated 2 shopping items from "Pasta" already on the shopping list')
  })

  it("supports a custom zero-state message", () => {
    expect(
      formatShoppingAddMessage(
        { added: 0, merged: 0 },
        {
          sourceName: "Pasta",
          itemLabel,
          zeroMessage: 'All shopping items from "Pasta" are already on the shopping list',
        }
      )
    ).toBe('All shopping items from "Pasta" are already on the shopping list')
  })
})

describe("isAlreadyInShoppingListError", () => {
  it("matches the duplicate manual-add error", () => {
    expect(isAlreadyInShoppingListError(new Error("Item already in shopping list"))).toBe(true)
  })

  it("ignores unrelated errors", () => {
    expect(isAlreadyInShoppingListError(new Error("network down"))).toBe(false)
  })
})
