import { describe, expect, it } from "vitest"
import {
  canonicalizeShoppingIngredient,
  pluralizeCanonicalShoppingName,
} from "../shopping-ingredient-canonicalization"

describe("canonicalizeShoppingIngredient", () => {
  const mustMerge = [
    ["egg", "eggs", "egg"],
    ["large egg", "large eggs", "large egg"],
    ["Large Egg", "  large   egg  ", "large egg"],
    ["onion", "onions", "onion"],
    ["diced onion", "onion sliced", "onion"],
    ["large diced onion", "sliced large onions", "large onion"],
    ["optional parsley", "parsley", "parsley"],
  ] as const

  it.each(mustMerge)(
    "gives %s and %s the shared key %s",
    (left, right, expectedKey) => {
      expect(canonicalizeShoppingIngredient({ item: left }).mergeKey).toBe(
        expectedKey
      )
      expect(canonicalizeShoppingIngredient({ item: right }).mergeKey).toBe(
        expectedKey
      )
    }
  )

  const mustNotMerge = [
    ["egg", "egg white"],
    ["large egg", "quail egg"],
    ["large egg", "egg"],
    ["red onion", "yellow onion"],
    ["green onion", "onion"],
    ["medium onion", "large onion"],
    ["whole milk", "evaporated milk"],
    ["tomato", "tomato sauce"],
    ["tomato", "tomato paste"],
    ["garlic", "garlic powder"],
    ["chicken breast", "chicken thighs"],
    ["boneless chicken breast", "chicken breast"],
    ["fresh parsley", "dried parsley"],
    ["olive oil", "extra-virgin olive oil"],
    ["canned tomatoes", "fresh tomatoes"],
    ["kosher salt", "salt"],
  ] as const

  it.each(mustNotMerge)("keeps %s separate from %s", (left, right) => {
    expect(canonicalizeShoppingIngredient({ item: left }).mergeKey).not.toBe(
      canonicalizeShoppingIngredient({ item: right }).mergeKey
    )
  })

  it("returns a structured identity and preparation contract", () => {
    expect(
      canonicalizeShoppingIngredient({
        item: "  RED onions,  ",
        modifier: "diced, optional",
      })
    ).toEqual({
      baseName: "onion",
      identityModifiers: ["red"],
      preparationModifiers: ["diced"],
      optional: true,
      displayName: "red onion",
      mergeKey: "red onion",
    })
  })

  it("treats an explicit multi-word size modifier as purchase identity", () => {
    const fromItem = canonicalizeShoppingIngredient({ item: "extra-large egg" })
    const fromModifier = canonicalizeShoppingIngredient({
      item: "egg",
      modifier: "extra large",
    })

    expect(fromModifier).toEqual(fromItem)
    expect(fromModifier.mergeKey).toBe("extra large egg")
    expect(fromModifier.mergeKey).not.toBe(
      canonicalizeShoppingIngredient({ item: "egg" }).mergeKey
    )
  })

  it("is stable when its canonical display is canonicalized again", () => {
    const first = canonicalizeShoppingIngredient({ item: " Large  Eggs " })
    const second = canonicalizeShoppingIngredient({ item: first.displayName })

    expect(second).toEqual(first)
  })

  it.each(["LARGE EGG", "large egg", "  large   egg  "])(
    "is case and whitespace invariant for %s",
    (value) => {
      expect(canonicalizeShoppingIngredient({ item: value }).mergeKey).toBe(
        "large egg"
      )
    }
  )

  it("pluralizes only controlled purchase nouns", () => {
    expect(pluralizeCanonicalShoppingName("egg")).toBe("eggs")
    expect(pluralizeCanonicalShoppingName("large egg")).toBe("large eggs")
    expect(pluralizeCanonicalShoppingName("tomato")).toBe("tomatoes")
    expect(pluralizeCanonicalShoppingName("chicken thigh")).toBe(
      "chicken thighs"
    )
    expect(pluralizeCanonicalShoppingName("berry")).toBe("berries")
  })
})
