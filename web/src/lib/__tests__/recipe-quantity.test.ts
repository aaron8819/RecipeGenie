import { describe, expect, it } from "vitest"
import { parseIngredientLine } from "@/lib/recipe-parser"
import {
  divideRationals,
  formatRecipeQuantity,
  getAuthoredYieldText,
  getSelectedYieldText,
  getScalingBasis,
  isValidQuantityV1,
  multiplyRationals,
  normalizePackageV1,
  normalizeQuantityV1,
  normalizeScaleRatioV1,
  normalizeYieldMetadataV1,
  parseQuantityV1,
  parseRationalLexeme,
  parseYieldMetadata,
  rationalFromIntegers,
  resolveIngredientQuantity,
} from "@/lib/recipe-quantity"
import type { Ingredient } from "@/types/database"

function format(
  line: string,
  basis: number,
  selected: number
): string {
  return formatRecipeQuantity(
    parseIngredientLine(line),
    basis,
    selected
  ).text
}

describe("exact recipe quantities", () => {
  it("parses and reduces integers, fractions, mixed values, unicode, and literal decimals", () => {
    expect(parseRationalLexeme("6/8")).toEqual({
      numerator: "3",
      denominator: "4",
    })
    expect(parseRationalLexeme("1 1/2")).toEqual({
      numerator: "3",
      denominator: "2",
    })
    expect(parseRationalLexeme("1½")).toEqual({
      numerator: "3",
      denominator: "2",
    })
    expect(parseRationalLexeme("0.50")).toEqual({
      numerator: "1",
      denominator: "2",
    })
    expect(parseRationalLexeme("0.33")).toEqual({
      numerator: "33",
      denominator: "100",
    })
    expect(parseRationalLexeme("1/0")).toBeNull()
  })

  it("performs exact persisted rational arithmetic", () => {
    expect(
      multiplyRationals(
        rationalFromIntegers(1, 3),
        rationalFromIntegers(3, 4)
      )
    ).toEqual({ numerator: "1", denominator: "4" })
    expect(
      divideRationals(
        rationalFromIntegers(3, 4),
        rationalFromIntegers(3, 2)
      )
    ).toEqual({ numerator: "1", denominator: "2" })
  })

  it("parses ranges, qualifiers, qualitative values, and explicit fallback", () => {
    const range = parseQuantityV1("about 1/2–1½")
    expect(range).toMatchObject({
      kind: "range",
      authored: "about 1/2–1½",
      qualifier: "about",
      startLexeme: "1/2",
      endLexeme: "1½",
      separator: "–",
    })
    expect(parseQuantityV1("to taste")).toMatchObject({
      kind: "qualitative",
    })
    expect(parseQuantityV1("1-ish")).toMatchObject({
      kind: "unparsed",
    })
    expect(isValidQuantityV1(range)).toBe(true)
  })

  it("rejects malformed and impractically large persisted rationals before BigInt conversion", () => {
    const valid = parseQuantityV1("1/2")
    expect(normalizeQuantityV1(valid)).toEqual(valid)
    expect(
      normalizeQuantityV1({
        ...valid,
        authored: 0.5,
      })
    ).toBeNull()
    expect(
      normalizeQuantityV1({
        ...valid,
        value: { numerator: "1000000000000", denominator: "1" },
      })
    ).toBeNull()
    expect(
      normalizeQuantityV1({
        ...valid,
        value: { numerator: "1", denominator: "0000000000001" },
      })
    ).toBeNull()
    expect(
      normalizeQuantityV1({
        ...valid,
        value: { numerator: "-0", denominator: "1" },
      })
    ).toBeNull()
    expect(
      normalizeQuantityV1({
        ...valid,
        value: { numerator: "1", denominator: "0" },
      })
    ).toBeNull()
    expect(normalizeQuantityV1({ ...valid, unexpected: true })).toBeNull()
    expect(normalizeQuantityV1([])).toBeNull()
    expect(normalizeQuantityV1(null)).toBeNull()
    expect(parseRationalLexeme("9".repeat(13))).toBeNull()
    expect(parseRationalLexeme("99999999")).not.toBeNull()
  })

  it("rejects partial package, yield, and scale metadata", () => {
    expect(normalizePackageV1({})).toBeNull()
    expect(
      normalizePackageV1({
        version: 1,
        count: parseQuantityV1("1"),
        size: {
          value: { numerator: "14", denominator: "1" },
          lexeme: "14",
          unit: "oz",
          authoredUnit: "oz",
        },
        type: "can",
        authoredType: "can",
      })
    ).not.toBeNull()
    expect(normalizeScaleRatioV1({ numerator: "0", denominator: "1" })).toBeNull()
    expect(
      normalizeScaleRatioV1({ numerator: "101", denominator: "1" })
    ).toBeNull()
    expect(
      normalizeYieldMetadataV1({
        version: 1,
        authoredText: 4,
        kind: "servings",
        scalingBasis: { numerator: "4", denominator: "1" },
      })
    ).toBeNull()
  })
})

describe("recipe quantity formatting", () => {
  it.each([
    ["1 lb ground beef", "¾ lb"],
    ["1 tsp chili powder", "¾ tsp"],
    ["½ tsp smoked paprika", "⅜ tsp"],
    ["¼ cup water", "3 tbsp"],
    ["6 cups greens", "4½ cups"],
    ["1 cup tomatoes", "¾ cup"],
    ["¼ cup onion", "3 tbsp"],
    ["1 avocado", "¾"],
  ])("scales 4→3: %s", (line, expected) => {
    expect(format(line, 4, 3)).toBe(expected)
  })

  it.each([
    ["¾ cup flour", 4, 6, "1⅛ cups"],
    ["2 tbsp oil", 4, 1, "1½ tsp"],
    ["1–2 tbsp sugar", 4, 3, "¾–1½ tbsp"],
    ["¼–½ cup stock", 4, 3, "3–6 tbsp"],
    ["about 1 cup milk", 4, 3, "about ¾ cup"],
    ["1 L water", 4, 3, "750 mL"],
    ["500 g flour", 4, 6, "750 g"],
    ["250 mL stock", 4, 3, "≈190 mL"],
    ["2 eggs", 4, 3, "1½"],
    ["1 egg", 6, 5, "5/6"],
    ["1 (14 oz) can tomatoes", 4, 3, "¾ of a 14 oz can"],
    ["about 1 (14 oz) can tomatoes", 4, 3, "about ¾ of a 14 oz can"],
    ["2 (14 oz) cans tomatoes", 4, 6, "3 14 oz cans"],
    ["1–2 (14 oz) cans tomatoes", 4, 6, "1½–3 14 oz cans"],
  ])("formats %s from %s→%s", (line, basis, selected, expected) => {
    expect(format(line, basis, selected)).toBe(expected)
  })

  it("restores authored lexemes exactly at the scaling basis", () => {
    for (const [line, expected] of [
      ["½ cup milk", "½ cup"],
      ["1/2 cup milk", "1/2 cup"],
      ["1 1/2 cups flour", "1 1/2 cups"],
      ["0.50 cup milk", "0.50 cup"],
      ["1 - 2 tbsp sugar", "1 - 2 tbsp"],
      ["about 1 (14 oz) can tomatoes", "about 1 (14 oz) can"],
      ["1–2 (14 oz) cans tomatoes", "1–2 (14 oz) cans"],
    ]) {
      expect(format(line, 4, 4)).toBe(expected)
    }
  })

  it("is drift-free because every target is calculated from authored values", () => {
    const ingredient = parseIngredientLine("½ tsp paprika")
    expect(formatRecipeQuantity(ingredient, 4, 3).text).toBe("⅜ tsp")
    expect(formatRecipeQuantity(ingredient, 4, 7).text).toBe("⅞ tsp")
    expect(formatRecipeQuantity(ingredient, 4, 3).text).toBe("⅜ tsp")
    expect(formatRecipeQuantity(ingredient, 4, 4).text).toBe("½ tsp")
  })

  it("leaves qualitative and malformed quantities unchanged", () => {
    expect(format("salt, to taste", 4, 3)).toBe("")
    expect(format("1/0 cup mystery", 4, 3)).toBe("1/0")
  })

  it("only flags genuinely impractical tiny measures", () => {
    expect(
      formatRecipeQuantity(parseIngredientLine("1/16 tsp spice"), 4, 3)
        .hardToMeasure
    ).toBe(true)
    expect(
      formatRecipeQuantity(parseIngredientLine("¼ cup water"), 4, 3)
        .hardToMeasure
    ).toBe(false)
  })
})

describe("legacy quantity adapter", () => {
  it("prefers valid structured data", () => {
    const ingredient = parseIngredientLine("½ cup milk")
    ingredient.originalText = "9 cups stale milk"
    expect(resolveIngredientQuantity(ingredient).provenance).toBe("authored")
  })

  it("uses originalText only while it matches current legacy fields", () => {
    const trustworthy: Ingredient = {
      item: "milk",
      amount: 0.5,
      unit: "cup",
      originalText: "½ cup milk",
    }
    expect(resolveIngredientQuantity(trustworthy).provenance).toBe(
      "original-text"
    )

    expect(
      resolveIngredientQuantity({ ...trustworthy, amount: 2 }).provenance
    ).toBe("legacy-synthesized")
    expect(
      resolveIngredientQuantity({ ...trustworthy, item: "cream" }).provenance
    ).toBe("legacy-synthesized")
  })

  it("fails safely for missing and malformed legacy values", () => {
    expect(
      resolveIngredientQuantity({ item: "salt", amount: null, unit: "" })
    ).toMatchObject({ quantity: null, provenance: "missing" })
    expect(
      resolveIngredientQuantity({
        item: "mystery",
        amount: "1/0",
        unit: "cup",
      })
    ).toMatchObject({
      provenance: "legacy-synthesized",
      quantity: { kind: "unparsed" },
    })
  })
})

describe("yield metadata", () => {
  it("preserves serving ranges and uses the lower endpoint as basis", () => {
    const metadata = parseYieldMetadata("4–5 servings")
    expect(metadata).toMatchObject({
      authoredText: "4–5 servings",
      kind: "servings",
      scalingBasis: { numerator: "4", denominator: "1" },
      range: {
        startLexeme: "4",
        endLexeme: "5",
        separator: "–",
      },
    })
    expect(getScalingBasis(metadata, 9)).toBe(4)
    expect(getAuthoredYieldText(metadata, 9)).toBe("4–5 servings")
  })

  it("keeps item yields distinct from servings", () => {
    const metadata = parseYieldMetadata("12 cookies")
    expect(metadata).toMatchObject({
      authoredText: "12 cookies",
      kind: "items",
      scalingBasis: { numerator: "12", denominator: "1" },
    })
  })

  it("preserves qualified non-serving yields", () => {
    const metadata = parseYieldMetadata("about 1 loaf")
    expect(metadata).toMatchObject({
      authoredText: "about 1 loaf",
      kind: "other",
      value: { numerator: "1", denominator: "1" },
      scalingBasis: { numerator: "1", denominator: "1" },
    })
    expect(getSelectedYieldText(metadata, 1, 1)).toBe("about 1 loaf")
    expect(getSelectedYieldText(metadata, 1, 2)).toBe("2 loaves")
    expect(
      getSelectedYieldText(parseYieldMetadata("12 cookies"), 12, 6)
    ).toBe("6 cookies")
  })

  it("keeps an explicitly edited basis", () => {
    expect(parseYieldMetadata("4–5 servings", 5)?.scalingBasis).toEqual({
      numerator: "5",
      denominator: "1",
    })
  })
})
