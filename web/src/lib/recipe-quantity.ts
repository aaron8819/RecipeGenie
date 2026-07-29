import type {
  Ingredient,
  PackageV1,
  QuantitySourceV1,
  QuantityV1,
  RationalV1,
  YieldKindV1,
  YieldMetadataV1,
} from "@/types/database"

const UNICODE_FRACTIONS: Record<string, readonly [bigint, bigint]> = {
  "½": [1n, 2n],
  "⅓": [1n, 3n],
  "⅔": [2n, 3n],
  "¼": [1n, 4n],
  "¾": [3n, 4n],
  "⅕": [1n, 5n],
  "⅖": [2n, 5n],
  "⅗": [3n, 5n],
  "⅘": [4n, 5n],
  "⅙": [1n, 6n],
  "⅚": [5n, 6n],
  "⅛": [1n, 8n],
  "⅜": [3n, 8n],
  "⅝": [5n, 8n],
  "⅞": [7n, 8n],
}

const UNICODE_FRACTION_PATTERN = Object.keys(UNICODE_FRACTIONS).join("")
const QUANTITY_ENDPOINT = String.raw`(?:\d+\s+\d+\/\d+|\d+[${UNICODE_FRACTION_PATTERN}]|[${UNICODE_FRACTION_PATTERN}]|\d+\/\d+|\d+(?:\.\d+)?)`
const QUANTITY_PATTERN = new RegExp(
  String.raw`^(?:(about|approx\.?|approximately|around)\s+)?(${QUANTITY_ENDPOINT})(?:\s*([-–—])\s*(${QUANTITY_ENDPOINT}))?$`,
  "i"
)
const QUANTITY_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(about|approx\.?|approximately|around)\s+)?(${QUANTITY_ENDPOINT})(?:\s*([-–—])\s*(${QUANTITY_ENDPOINT}))?(?=\s|$|[A-Za-z])`,
  "i"
)

const QUALITATIVE_PATTERN =
  /^(?:as needed|to taste|a pinch|pinch|a dash|dash|a sprinkle|sprinkle|some)$/i

const UNIT_ALIASES: Record<string, string> = {
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  c: "cup",
  "fl oz": "fl oz",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  gal: "gal",
  gallon: "gal",
  gallons: "gal",
  qt: "qt",
  quart: "qt",
  quarts: "qt",
  pt: "pt",
  pint: "pt",
  pints: "pt",
  ml: "mL",
  milliliter: "mL",
  milliliters: "mL",
  l: "L",
  liter: "L",
  liters: "L",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  can: "can",
  cans: "can",
  package: "package",
  packages: "package",
  pkg: "package",
  pkgs: "package",
  jar: "jar",
  jars: "jar",
  bottle: "bottle",
  bottles: "bottle",
  bag: "bag",
  bags: "bag",
  box: "box",
  boxes: "box",
  clove: "clove",
  cloves: "clove",
  head: "head",
  heads: "head",
  piece: "piece",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  slice: "slice",
  slices: "slice",
  pinch: "pinch",
  dash: "dash",
  count: "count",
  counts: "count",
  whole: "count",
  "whole/count": "count",
  "whole item": "count",
  "whole items": "count",
}

const SORTED_UNIT_ALIASES = Object.keys(UNIT_ALIASES).sort(
  (left, right) => right.length - left.length
)
const PACKAGE_TYPES = new Set([
  "can",
  "package",
  "jar",
  "bottle",
  "bag",
  "box",
])

type Rational = { numerator: bigint; denominator: bigint }

export type IngredientQuantityResolution = {
  quantity: QuantityV1 | null
  authoredUnit: string
  packageV1?: PackageV1
  provenance: QuantitySourceV1 | "missing"
}

export type FormattedRecipeQuantity = {
  text: string
  hardToMeasure: boolean
  approximate: boolean
  exact: QuantityV1 | null
}

export type ParsedIngredientQuantityPrefix = {
  quantityV1: QuantityV1
  authoredUnit: string
  unit: string
  packageV1?: PackageV1
  rest: string
  confidence: "high" | "low"
}

/**
 * Shared trust-boundary limits for persisted/imported quantity metadata.
 * Components are intentionally small enough to bound BigInt work while the
 * represented value remains generous for real recipes and yields.
 */
export const RECIPE_QUANTITY_LIMITS = {
  rationalDigits: 12,
  rationalComponent: 999_999_999_999n,
  rationalValue: 100_000_000n,
  yieldValue: 10_000,
  selectedYield: 100,
  scaleRatio: 100,
  authoredQuantityLength: 128,
  authoredYieldLength: 256,
  lexemeLength: 64,
  unitLength: 64,
  packageTypeLength: 32,
  reasonLength: 256,
  ingredientLineLength: 2_048,
} as const

const QUANTITY_SOURCES = new Set<QuantitySourceV1>([
  "authored",
  "original-text",
  "legacy-synthesized",
])
const QUANTITY_QUALIFIERS = new Set([
  "about",
  "approximately",
  "around",
])
const RANGE_SEPARATORS = new Set(["-", "–", "—"])
const YIELD_KINDS = new Set<YieldKindV1>([
  "servings",
  "portions",
  "items",
  "other",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function boundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false
): string | null {
  if (typeof value !== "string" || value.length > maximumLength) return null
  if (!allowEmpty && value.trim().length === 0) return null
  return value
}

function bigintAbs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function gcd(left: bigint, right: bigint): bigint {
  let a = bigintAbs(left)
  let b = bigintAbs(right)
  while (b !== 0n) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1n
}

function rational(
  numerator: bigint,
  denominator: bigint
): Rational {
  if (denominator === 0n) {
    throw new Error("Quantity denominator cannot be zero")
  }
  const sign = denominator < 0n ? -1n : 1n
  const divisor = gcd(numerator, denominator)
  return {
    numerator: (numerator / divisor) * sign,
    denominator: bigintAbs(denominator / divisor),
  }
}

function parseBoundedInteger(value: unknown): bigint | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > RECIPE_QUANTITY_LIMITS.rationalDigits + 1 ||
    !/^-?\d+$/.test(value)
  ) {
    return null
  }
  const digits = value.startsWith("-") ? value.slice(1) : value
  if (digits.length > RECIPE_QUANTITY_LIMITS.rationalDigits) return null
  try {
    const parsed = BigInt(value)
    return bigintAbs(parsed) <= RECIPE_QUANTITY_LIMITS.rationalComponent
      ? parsed
      : null
  } catch {
    return null
  }
}

function fromPersisted(
  value: unknown,
  options: { positive?: boolean; nonNegative?: boolean } = {}
): Rational | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["numerator", "denominator"])
  ) {
    return null
  }
  const numerator = parseBoundedInteger(value.numerator)
  const denominator = parseBoundedInteger(value.denominator)
  if (numerator == null || denominator == null || denominator === 0n) {
    return null
  }
  const normalized = rational(numerator, denominator)
  if (options.positive && normalized.numerator <= 0n) return null
  if (options.nonNegative && normalized.numerator < 0n) return null
  if (
    bigintAbs(normalized.numerator) >
    RECIPE_QUANTITY_LIMITS.rationalValue * normalized.denominator
  ) {
    return null
  }
  return normalized
}

function persist(value: Rational): RationalV1 {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
  }
}

export function normalizeRationalV1(
  value: unknown,
  options: { positive?: boolean; nonNegative?: boolean } = {}
): RationalV1 | null {
  const parsed = fromPersisted(value, options)
  return parsed ? persist(parsed) : null
}

function persistBounded(
  value: Rational,
  options: { positive?: boolean; nonNegative?: boolean } = {}
): RationalV1 | null {
  return normalizeRationalV1(persist(value), options)
}

export function rationalFromIntegers(
  numerator: number,
  denominator = 1
): RationalV1 {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator)
  ) {
    throw new Error("Rational integer inputs must be safe integers")
  }
  const result = persistBounded(
    rational(BigInt(numerator), BigInt(denominator))
  )
  if (!result) {
    throw new Error("Rational integer inputs exceed recipe quantity limits")
  }
  return result
}

export function multiplyRationals(
  left: RationalV1,
  right: RationalV1
): RationalV1 | null {
  const a = fromPersisted(left)
  const b = fromPersisted(right)
  return a && b
    ? persist(rational(a.numerator * b.numerator, a.denominator * b.denominator))
    : null
}

export function divideRationals(
  left: RationalV1,
  right: RationalV1
): RationalV1 | null {
  const a = fromPersisted(left)
  const b = fromPersisted(right)
  if (!a || !b || b.numerator === 0n) return null
  return persist(rational(a.numerator * b.denominator, a.denominator * b.numerator))
}

export function rationalToNumber(value: RationalV1): number | null {
  const parsed = fromPersisted(value)
  if (!parsed) return null
  return Number(parsed.numerator) / Number(parsed.denominator)
}

function addRationals(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  )
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.numerator,
    left.denominator * right.denominator
  )
}

function compare(left: Rational, right: Rational): number {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

function parseDecimal(value: string): Rational {
  const [whole, fraction = ""] = value.split(".")
  const denominator = 10n ** BigInt(fraction.length)
  return rational(
    BigInt(whole) * denominator + BigInt(fraction || "0"),
    denominator
  )
}

export function parseRationalLexeme(value: string): RationalV1 | null {
  const lexeme = value.trim()
  if (
    lexeme.length === 0 ||
    lexeme.length > RECIPE_QUANTITY_LIMITS.lexemeLength ||
    new RegExp(`\\d{${RECIPE_QUANTITY_LIMITS.rationalDigits + 1},}`).test(
      lexeme
    )
  ) {
    return null
  }
  const unicode = lexeme.match(
    new RegExp(String.raw`^(\d+)?([${UNICODE_FRACTION_PATTERN}])$`)
  )
  if (unicode) {
    const [numerator, denominator] = UNICODE_FRACTIONS[unicode[2]]
    const whole = BigInt(unicode[1] || "0")
    return persistBounded(addRationals(
      rational(whole, 1n),
      rational(numerator, denominator)
    ), { nonNegative: true })
  }

  const mixed = lexeme.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    try {
      const denominator = BigInt(mixed[3])
      if (denominator === 0n) return null
      return persistBounded(addRationals(
        rational(BigInt(mixed[1]), 1n),
        rational(BigInt(mixed[2]), denominator)
      ), { nonNegative: true })
    } catch {
      return null
    }
  }

  const fraction = lexeme.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    try {
      const denominator = BigInt(fraction[2])
      if (denominator === 0n) return null
      return persistBounded(
        rational(BigInt(fraction[1]), denominator),
        { nonNegative: true }
      )
    } catch {
      return null
    }
  }

  if (/^\d+(?:\.\d+)?$/.test(lexeme)) {
    try {
      return persistBounded(parseDecimal(lexeme), { nonNegative: true })
    } catch {
      return null
    }
  }

  return null
}

function normalizeQualifier(
  value: string | undefined
): QuantityV1["qualifier"] {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === "around") return "around"
  if (normalized.startsWith("approx")) return "approximately"
  return "about"
}

export function parseQuantityV1(
  value: string,
  source: QuantitySourceV1 = "authored"
): QuantityV1 {
  const authored = value.trim()
  if (
    authored.length === 0 ||
    authored.length > RECIPE_QUANTITY_LIMITS.authoredQuantityLength
  ) {
    return {
      version: 1,
      kind: "unparsed",
      authored: authored.slice(
        0,
        RECIPE_QUANTITY_LIMITS.authoredQuantityLength
      ),
      source,
      reason: "Quantity exceeds supported limits",
    }
  }
  if (QUALITATIVE_PATTERN.test(authored)) {
    return { version: 1, kind: "qualitative", authored, source }
  }

  const match = authored.match(QUANTITY_PATTERN)
  if (!match) {
    return {
      version: 1,
      kind: "unparsed",
      authored,
      source,
      reason: "Unsupported or ambiguous quantity",
    }
  }

  const start = parseRationalLexeme(match[2])
  const end = match[4] ? parseRationalLexeme(match[4]) : null
  if (!start || (match[4] && !end)) {
    return {
      version: 1,
      kind: "unparsed",
      authored,
      source,
      reason: "Invalid quantity",
    }
  }

  const qualifier = normalizeQualifier(match[1])
  if (match[4] && end) {
    return {
      version: 1,
      kind: "range",
      authored,
      source,
      qualifier,
      start,
      end,
      startLexeme: match[2],
      endLexeme: match[4],
      separator: match[3] as "-" | "–" | "—",
    }
  }

  return {
    version: 1,
    kind: "exact",
    authored,
    source,
    qualifier,
    value: start,
    lexeme: match[2],
  }
}

export function normalizeQuantityV1(value: unknown): QuantityV1 | null {
  if (!isRecord(value) || value.version !== 1) return null

  const kind = value.kind
  const authored = boundedString(
    value.authored,
    RECIPE_QUANTITY_LIMITS.authoredQuantityLength
  )
  const source =
    typeof value.source === "string" &&
    QUANTITY_SOURCES.has(value.source as QuantitySourceV1)
      ? value.source as QuantitySourceV1
      : null
  const qualifier =
    value.qualifier === undefined
      ? undefined
      : typeof value.qualifier === "string" &&
          QUANTITY_QUALIFIERS.has(value.qualifier)
        ? value.qualifier as QuantityV1["qualifier"]
        : null
  if (!authored || !source || qualifier === null) return null

  const base = {
    version: 1 as const,
    authored,
    source,
    ...(qualifier ? { qualifier } : {}),
  }

  if (kind === "exact") {
    if (
      !hasOnlyKeys(value, [
        "version",
        "kind",
        "authored",
        "source",
        "qualifier",
        "value",
        "lexeme",
      ])
    ) {
      return null
    }
    const exact = normalizeRationalV1(value.value, { positive: true })
    const lexeme = boundedString(
      value.lexeme,
      RECIPE_QUANTITY_LIMITS.lexemeLength
    )
    return exact && lexeme
      ? { ...base, kind: "exact", value: exact, lexeme }
      : null
  }

  if (kind === "range") {
    if (
      !hasOnlyKeys(value, [
        "version",
        "kind",
        "authored",
        "source",
        "qualifier",
        "start",
        "end",
        "startLexeme",
        "endLexeme",
        "separator",
      ])
    ) {
      return null
    }
    const start = normalizeRationalV1(value.start, { positive: true })
    const end = normalizeRationalV1(value.end, { positive: true })
    const startLexeme = boundedString(
      value.startLexeme,
      RECIPE_QUANTITY_LIMITS.lexemeLength
    )
    const endLexeme = boundedString(
      value.endLexeme,
      RECIPE_QUANTITY_LIMITS.lexemeLength
    )
    const separator: "-" | "–" | "—" | null =
      typeof value.separator === "string" &&
      RANGE_SEPARATORS.has(value.separator)
        ? value.separator as "-" | "–" | "—"
        : null
    const parsedStart = start ? fromPersisted(start, { positive: true }) : null
    const parsedEnd = end ? fromPersisted(end, { positive: true }) : null
    if (
      !start ||
      !end ||
      !startLexeme ||
      !endLexeme ||
      !separator ||
      !parsedStart ||
      !parsedEnd ||
      compare(parsedStart, parsedEnd) > 0
    ) {
      return null
    }
    return {
      ...base,
      kind: "range",
      start,
      end,
      startLexeme,
      endLexeme,
      separator,
    }
  }

  if (kind === "qualitative") {
    return hasOnlyKeys(value, [
      "version",
      "kind",
      "authored",
      "source",
      "qualifier",
    ])
      ? { ...base, kind: "qualitative" }
      : null
  }

  if (kind === "unparsed") {
    if (
      !hasOnlyKeys(value, [
        "version",
        "kind",
        "authored",
        "source",
        "qualifier",
        "reason",
      ])
    ) {
      return null
    }
    const reason =
      value.reason === undefined
        ? undefined
        : boundedString(
            value.reason,
            RECIPE_QUANTITY_LIMITS.reasonLength
          )
    if (value.reason !== undefined && !reason) return null
    return {
      ...base,
      kind: "unparsed",
      ...(reason ? { reason } : {}),
    }
  }

  return null
}

export function isValidQuantityV1(value: unknown): value is QuantityV1 {
  return Boolean(normalizeQuantityV1(value))
}

export function normalizePackageV1(value: unknown): PackageV1 | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !hasOnlyKeys(value, [
      "version",
      "count",
      "size",
      "type",
      "authoredType",
    ])
  ) {
    return null
  }
  const count = normalizeQuantityV1(value.count)
  if (!count || !["exact", "range"].includes(count.kind)) return null
  if (
    !isRecord(value.size) ||
    !hasOnlyKeys(value.size, [
      "value",
      "lexeme",
      "unit",
      "authoredUnit",
    ])
  ) {
    return null
  }
  const sizeValue = normalizeRationalV1(value.size.value, { positive: true })
  const sizeLexeme = boundedString(
    value.size.lexeme,
    RECIPE_QUANTITY_LIMITS.lexemeLength
  )
  const sizeUnit = boundedString(
    value.size.unit,
    RECIPE_QUANTITY_LIMITS.unitLength
  )
  const authoredUnit = boundedString(
    value.size.authoredUnit,
    RECIPE_QUANTITY_LIMITS.unitLength
  )
  const type = boundedString(
    value.type,
    RECIPE_QUANTITY_LIMITS.packageTypeLength
  )
  const authoredType = boundedString(
    value.authoredType,
    RECIPE_QUANTITY_LIMITS.packageTypeLength
  )
  if (
    !sizeValue ||
    !sizeLexeme ||
    !sizeUnit ||
    !authoredUnit ||
    !type ||
    !PACKAGE_TYPES.has(type) ||
    !authoredType ||
    UNIT_ALIASES[authoredType.trim().toLowerCase()] !== type
  ) {
    return null
  }
  return {
    version: 1,
    count,
    size: {
      value: sizeValue,
      lexeme: sizeLexeme,
      unit: sizeUnit,
      authoredUnit,
    },
    type,
    authoredType,
  }
}

function unitPrefix(text: string): {
  authoredUnit: string
  unit: string
  length: number
} | null {
  const lower = text.toLowerCase()
  for (const alias of SORTED_UNIT_ALIASES) {
    if (
      lower === alias ||
      (lower.startsWith(alias) && /^\s/.test(text.slice(alias.length)))
    ) {
      return {
        authoredUnit: text.slice(0, alias.length),
        unit: UNIT_ALIASES[alias],
        length: alias.length,
      }
    }
  }
  return null
}

export function normalizeRecipeUnit(unit: string): string {
  return UNIT_ALIASES[unit.trim().toLowerCase()] || unit.trim()
}

export function parseIngredientQuantityPrefix(
  input: string,
  source: QuantitySourceV1 = "authored"
): ParsedIngredientQuantityPrefix | null {
  const text = input.trim()
  if (
    text.length === 0 ||
    text.length > RECIPE_QUANTITY_LIMITS.ingredientLineLength
  ) {
    return null
  }
  const match = text.match(QUANTITY_PREFIX_PATTERN)
  if (!match) {
    if (/^(?:about|approx\.?|approximately|around\s+)?\d+\//i.test(text)) {
      const token = text.split(/\s+/)[0]
      return {
        quantityV1: {
          version: 1,
          kind: "unparsed",
          authored: token,
          source,
          reason: "Invalid fraction",
        },
        authoredUnit: "",
        unit: "",
        rest: text.slice(token.length).trim(),
        confidence: "low",
      }
    }
    return null
  }

  const quantityLexeme = match[0].trim()
  const quantityV1 = parseQuantityV1(quantityLexeme, source)
  if (!isValidQuantityV1(quantityV1) || quantityV1.kind === "unparsed") {
    return {
      quantityV1,
      authoredUnit: "",
      unit: "",
      rest: text.slice(match[0].length).trim(),
      confidence: "low",
    }
  }

  let remaining = text.slice(match[0].length).trim()
  const packageMatch = remaining.match(
    new RegExp(
      String.raw`^\((${QUANTITY_ENDPOINT})\s+([^)]+)\)\s*(can|cans|package|packages|pkg|pkgs|jar|jars|bottle|bottles|bag|bags|box|boxes)\b`,
      "i"
    )
  )
  if (packageMatch) {
    const size = parseRationalLexeme(packageMatch[1])
    const packageType = UNIT_ALIASES[packageMatch[3].toLowerCase()]
    if (size && PACKAGE_TYPES.has(packageType)) {
      const authoredUnit = packageMatch[0].trim()
      const packageV1: PackageV1 = {
        version: 1,
        count: quantityV1,
        size: {
          value: size,
          lexeme: packageMatch[1],
          unit: normalizeRecipeUnit(packageMatch[2]),
          authoredUnit: packageMatch[2],
        },
        type: packageType,
        authoredType: packageMatch[3],
      }
      remaining = remaining.slice(packageMatch[0].length).trim()
      return {
        quantityV1,
        authoredUnit,
        unit: packageType,
        packageV1,
        rest: remaining,
        confidence: "high",
      }
    }
  }

  const unit = unitPrefix(remaining)
  if (unit) {
    remaining = remaining.slice(unit.length).trim()
    return {
      quantityV1,
      authoredUnit: unit.authoredUnit,
      unit: unit.unit,
      rest: remaining,
      confidence: "high",
    }
  }

  return {
    quantityV1,
    authoredUnit: "",
    unit: remaining ? "count" : "",
    rest: remaining,
    confidence: "high",
  }
}

function sameRational(left: RationalV1, right: RationalV1): boolean {
  const a = fromPersisted(left)
  const b = fromPersisted(right)
  return Boolean(a && b && compare(a, b) === 0)
}

function quantityMatchesLegacy(
  quantity: QuantityV1,
  amount: Ingredient["amount"]
): boolean {
  if (amount == null) {
    return quantity.kind === "qualitative" || quantity.kind === "unparsed"
  }
  const legacy = parseQuantityV1(String(amount), "legacy-synthesized")
  if (quantity.kind === "exact" && legacy.kind === "exact") {
    return sameRational(quantity.value, legacy.value)
  }
  if (quantity.kind === "range" && legacy.kind === "range") {
    return (
      sameRational(quantity.start, legacy.start) &&
      sameRational(quantity.end, legacy.end)
    )
  }
  return false
}

function sameQuantityValue(left: QuantityV1, right: QuantityV1): boolean {
  if (
    left.kind !== right.kind ||
    left.qualifier !== right.qualifier
  ) {
    return false
  }
  if (left.kind === "exact" && right.kind === "exact") {
    return sameRational(left.value, right.value)
  }
  if (left.kind === "range" && right.kind === "range") {
    return (
      sameRational(left.start, right.start) &&
      sameRational(left.end, right.end)
    )
  }
  return left.authored === right.authored
}

function normalizedWords(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cloneQuantitySource(
  quantity: QuantityV1,
  source: QuantitySourceV1
): QuantityV1 {
  return { ...quantity, source }
}

export function resolveIngredientQuantity(
  ingredient: Ingredient
): IngredientQuantityResolution {
  const quantity = normalizeQuantityV1(ingredient.quantityV1)
  const packageV1 = normalizePackageV1(ingredient.packageV1)
  if (quantity) {
    return {
      quantity,
      authoredUnit:
        typeof ingredient.authoredUnit === "string"
          ? ingredient.authoredUnit
          : typeof ingredient.unit === "string"
            ? ingredient.unit
            : "",
      packageV1:
        packageV1 && sameQuantityValue(quantity, packageV1.count)
          ? packageV1
          : undefined,
      provenance: quantity.source,
    }
  }

  if (
    typeof ingredient.originalText === "string" &&
    ingredient.originalText.length <=
      RECIPE_QUANTITY_LIMITS.authoredYieldLength * 8
  ) {
    const parsed = parseIngredientQuantityPrefix(
      ingredient.originalText,
      "original-text"
    )
    const currentItem = normalizedWords(ingredient.item)
    const originalRest = normalizedWords(parsed?.rest || "")
    const unitMatches =
      !parsed ||
      normalizeRecipeUnit(parsed.unit) ===
      normalizeRecipeUnit(
        typeof ingredient.unit === "string" ? ingredient.unit : ""
      )
    if (
      parsed?.confidence === "high" &&
      quantityMatchesLegacy(parsed.quantityV1, ingredient.amount) &&
      unitMatches &&
      (!currentItem || originalRest.includes(currentItem))
    ) {
      return {
        quantity: cloneQuantitySource(parsed.quantityV1, "original-text"),
        authoredUnit: parsed.authoredUnit,
        packageV1: parsed.packageV1,
        provenance: "original-text",
      }
    }
  }

  if (ingredient.amount != null) {
    const synthesized = parseQuantityV1(
      String(ingredient.amount),
      "legacy-synthesized"
    )
    return {
      quantity: synthesized,
      authoredUnit:
        typeof ingredient.unit === "string" ? ingredient.unit : "",
      provenance: "legacy-synthesized",
    }
  }

  return {
    quantity: null,
    authoredUnit:
      typeof ingredient.unit === "string" ? ingredient.unit : "",
    provenance: "missing",
  }
}

export function quantityToLegacyAmount(
  quantity: QuantityV1
): Ingredient["amount"] {
  if (quantity.kind === "exact") {
    const unicodeMixed = quantity.lexeme.match(
      new RegExp(String.raw`^(\d+)([${UNICODE_FRACTION_PATTERN}])$`)
    )
    if (unicodeMixed) {
      const [numerator, denominator] = UNICODE_FRACTIONS[unicodeMixed[2]]
      return Number(unicodeMixed[1]) + Number(numerator) / Number(denominator)
    }
    return rationalToNumber(quantity.value)
  }
  if (quantity.kind === "range") {
    const start = rationalToNumber(quantity.start)
    const end = rationalToNumber(quantity.end)
    return start == null || end == null ? quantity.authored : `${start}–${end}`
  }
  return null
}

function scaleQuantity(
  quantity: QuantityV1,
  ratio: Rational
): QuantityV1 {
  if (quantity.kind === "exact") {
    const value = fromPersisted(quantity.value)
    const scaled = value
      ? persistBounded(multiply(value, ratio), { positive: true })
      : null
    return scaled
      ? { ...quantity, value: scaled }
      : quantity
  }
  if (quantity.kind === "range") {
    const start = fromPersisted(quantity.start)
    const end = fromPersisted(quantity.end)
    const scaledStart = start
      ? persistBounded(multiply(start, ratio), { positive: true })
      : null
    const scaledEnd = end
      ? persistBounded(multiply(end, ratio), { positive: true })
      : null
    return scaledStart && scaledEnd
      ? {
          ...quantity,
          start: scaledStart,
          end: scaledEnd,
        }
      : quantity
  }
  return quantity
}

export function scaleQuantityV1(
  quantity: QuantityV1,
  ratio: RationalV1
): QuantityV1 {
  const parsedQuantity = normalizeQuantityV1(quantity)
  const parsedRatio = fromPersisted(ratio, { positive: true })
  return parsedQuantity && parsedRatio
    ? scaleQuantity(parsedQuantity, parsedRatio)
    : quantity
}

export function normalizeScaleRatioV1(value: unknown): RationalV1 | null {
  const normalized = normalizeRationalV1(value, { positive: true })
  const numeric = normalized ? rationalToNumber(normalized) : null
  return normalized &&
    numeric != null &&
    numeric <= RECIPE_QUANTITY_LIMITS.scaleRatio
    ? normalized
    : null
}

export function scalePackageV1(
  packageV1: unknown,
  ratio: unknown
): PackageV1 | null {
  const parsedPackage = normalizePackageV1(packageV1)
  const parsedRatio = normalizeScaleRatioV1(ratio)
  if (!parsedPackage || !parsedRatio) return null
  const count = scaleQuantityV1(parsedPackage.count, parsedRatio)
  const scaled = { ...parsedPackage, count }
  return normalizePackageV1(scaled)
}

function isOne(value: Rational): boolean {
  return value.numerator === value.denominator
}

function qualifierText(quantity: QuantityV1): string {
  return quantity.qualifier ? `${quantity.qualifier} ` : ""
}

const UNICODE_DISPLAY: Record<string, string> = {
  "1/2": "½",
  "1/4": "¼",
  "3/4": "¾",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
}

function roundedDecimal(
  value: Rational,
  digits: number
): { text: string; approximate: boolean } {
  const number = Number(value.numerator) / Number(value.denominator)
  const factor = 10 ** digits
  const rounded = Math.round(number * factor) / factor
  return {
    text: rounded.toFixed(digits).replace(/\.?0+$/, ""),
    approximate: Math.abs(number - rounded) > 1e-10,
  }
}

function formatRational(
  value: Rational,
  unit: string
): { text: string; approximate: boolean } {
  if (value.denominator === 1n) {
    return { text: value.numerator.toString(), approximate: false }
  }

  const whole = value.numerator / value.denominator
  const remainder = bigintAbs(value.numerator % value.denominator)
  const fractionKey = `${remainder}/${value.denominator}`
  const unicode = UNICODE_DISPLAY[fractionKey]
  if (unicode) {
    return {
      text: whole === 0n ? unicode : `${whole}${unicode}`,
      approximate: false,
    }
  }
  let terminatingDenominator = value.denominator
  while (terminatingDenominator % 2n === 0n) terminatingDenominator /= 2n
  while (terminatingDenominator % 5n === 0n) terminatingDenominator /= 5n
  if (terminatingDenominator === 1n) {
    return roundedDecimal(value, 4)
  }
  if (value.denominator <= 16n) {
    return {
      text:
        whole === 0n
          ? `${value.numerator}/${value.denominator}`
          : `${whole} ${remainder}/${value.denominator}`,
      approximate: false,
    }
  }

  const number = Number(value.numerator) / Number(value.denominator)
  const nearestEighth = Math.round(number * 8) / 8
  const tolerance =
    unit === "tsp" ? 0.03 : unit === "count" ? 0.01 : 0.015
  if (Math.abs(number - nearestEighth) <= tolerance) {
    return {
      ...formatRational(
        rational(BigInt(Math.round(nearestEighth * 8)), 8n),
        unit
      ),
      approximate: true,
    }
  }
  return roundedDecimal(value, unit === "mL" || unit === "g" ? 0 : 2)
}

type UnitDefinition = {
  family: "us-volume" | "us-weight" | "metric-volume" | "metric-weight"
  factor: Rational
}

const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  tsp: { family: "us-volume", factor: rational(1n, 1n) },
  tbsp: { family: "us-volume", factor: rational(3n, 1n) },
  "fl oz": { family: "us-volume", factor: rational(6n, 1n) },
  cup: { family: "us-volume", factor: rational(48n, 1n) },
  pt: { family: "us-volume", factor: rational(96n, 1n) },
  qt: { family: "us-volume", factor: rational(192n, 1n) },
  gal: { family: "us-volume", factor: rational(768n, 1n) },
  oz: { family: "us-weight", factor: rational(1n, 1n) },
  lb: { family: "us-weight", factor: rational(16n, 1n) },
  mL: { family: "metric-volume", factor: rational(1n, 1n) },
  L: { family: "metric-volume", factor: rational(1000n, 1n) },
  g: { family: "metric-weight", factor: rational(1n, 1n) },
  kg: { family: "metric-weight", factor: rational(1000n, 1n) },
}

function convertUnit(
  value: Rational,
  fromUnit: string,
  toUnit: string
): Rational | null {
  const from = UNIT_DEFINITIONS[fromUnit]
  const to = UNIT_DEFINITIONS[toUnit]
  if (!from || !to || from.family !== to.family) return null
  return rational(
    value.numerator * from.factor.numerator * to.factor.denominator,
    value.denominator * from.factor.denominator * to.factor.numerator
  )
}

function chooseUnit(values: Rational[], authoredUnit: string): string {
  const unit = normalizeRecipeUnit(authoredUnit)
  if (!UNIT_DEFINITIONS[unit]) return unit

  if (unit === "cup") {
    const hasAwkwardCup = values.some(
      (value) => value.denominator > 8n
    )
    if (hasAwkwardCup) {
      const tablespoons = values.map((value) => convertUnit(value, unit, "tbsp"))
      if (
        tablespoons.every(
          (value) =>
            value &&
            [1n, 2n, 4n, 8n].includes(value.denominator)
        )
      ) {
        return "tbsp"
      }
    }
  }
  if (unit === "tbsp" && values.length === 1) {
    const hasFractionalTablespoon = values.some(
      (value) => value.denominator !== 1n
    )
    if (hasFractionalTablespoon) {
      const teaspoons = values.map((value) => convertUnit(value, unit, "tsp"))
      if (
        teaspoons.every(
          (value) => value && value.denominator <= 8n
        )
      ) {
        return "tsp"
      }
    }
  }
  if (unit === "L" && values.every((value) => compare(value, rational(1n, 1n)) < 0)) {
    return "mL"
  }
  if (unit === "kg" && values.every((value) => compare(value, rational(1n, 1n)) < 0)) {
    return "g"
  }
  return unit
}

function pluralizeUnit(unit: string, values: Rational[]): string {
  if (["tsp", "tbsp", "oz", "lb", "fl oz", "mL", "L", "g", "kg"].includes(unit)) {
    return unit
  }
  const singular = values.every(
    (value) => compare(value, rational(1n, 1n)) <= 0
  )
  if (singular) return unit
  const irregular: Record<string, string> = {
    box: "boxes",
  }
  return irregular[unit] || (unit.endsWith("s") ? unit : `${unit}s`)
}

function formatMetricRounded(
  value: Rational,
  unit: string
): { text: string; approximate: boolean } | null {
  if (!["mL", "g"].includes(unit) || value.denominator === 1n) return null
  const number = Number(value.numerator) / Number(value.denominator)
  const rounded = Math.round(number / 5) * 5
  return { text: String(rounded), approximate: Math.abs(number - rounded) > 1e-10 }
}

function formatPackage(
  quantity: QuantityV1,
  packageV1: PackageV1,
  ratio: Rational,
  restoreAuthored: boolean
): FormattedRecipeQuantity {
  if (restoreAuthored) {
    return {
      text: `${quantity.authored} (${packageV1.size.lexeme} ${packageV1.size.authoredUnit}) ${packageV1.authoredType}`
        .replace(/\s+/g, " ")
        .trim(),
      hardToMeasure: false,
      approximate: false,
      exact: quantity,
    }
  }

  const scaled = scaleQuantity(quantity, ratio)
  const counts =
    scaled.kind === "exact"
      ? [fromPersisted(scaled.value, { positive: true })]
      : scaled.kind === "range"
        ? [
            fromPersisted(scaled.start, { positive: true }),
            fromPersisted(scaled.end, { positive: true }),
          ]
        : []
  if (counts.length === 0 || counts.some((count) => !count)) {
    return {
      text: `${quantity.authored} (${packageV1.size.lexeme} ${packageV1.size.authoredUnit}) ${packageV1.authoredType}`
        .replace(/\s+/g, " ")
        .trim(),
      hardToMeasure: false,
      approximate: false,
      exact: scaled,
    }
  }
  const validCounts = counts as Rational[]
  const formatted = validCounts.map((count) => formatRational(count, "count"))
  const size = `${packageV1.size.lexeme} ${packageV1.size.authoredUnit}`
  const underOne =
    scaled.kind === "exact" &&
    compare(validCounts[0], rational(0n, 1n)) > 0 &&
    compare(validCounts[0], rational(1n, 1n)) < 0
  const type = underOne
    ? packageV1.type
    : pluralizeUnit(packageV1.type, validCounts)
  const countText =
    scaled.kind === "range"
      ? `${formatted[0].text}${scaled.separator}${formatted[1].text}`
      : formatted[0].text
  const approximate = formatted.some((part) => part.approximate)
  return {
    text: `${qualifierText(scaled)}${approximate ? "≈" : ""}${countText}${underOne ? " of a" : ""} ${size} ${type}`,
    hardToMeasure: false,
    approximate,
    exact: scaled,
  }
}

function formatScaledQuantity(
  scaled: QuantityV1,
  authoredUnit: string
): FormattedRecipeQuantity {
  if (scaled.kind === "qualitative" || scaled.kind === "unparsed") {
    return {
      text: scaled.authored,
      hardToMeasure: false,
      approximate: false,
      exact: scaled,
    }
  }

  const rawValues =
    scaled.kind === "exact"
      ? [fromPersisted(scaled.value, { positive: true })]
      : [
          fromPersisted(scaled.start, { positive: true }),
          fromPersisted(scaled.end, { positive: true }),
        ]
  if (rawValues.some((value) => !value)) {
    return {
      text: scaled.authored,
      hardToMeasure: false,
      approximate: false,
      exact: scaled,
    }
  }
  const values = rawValues as Rational[]
  const fromUnit = normalizeRecipeUnit(authoredUnit)
  const displayUnit = chooseUnit(values, fromUnit)
  const converted = values.map(
    (value) => convertUnit(value, fromUnit, displayUnit) || value
  )
  const formatted = converted.map(
    (value) =>
      formatMetricRounded(value, displayUnit) ||
      formatRational(value, displayUnit)
  )
  const approximate = formatted.some((value) => value.approximate)
  const quantityText =
    scaled.kind === "range"
      ? `${formatted[0].text}${scaled.separator}${formatted[1].text}`
      : formatted[0].text
  const unitText =
    !displayUnit || displayUnit === "count"
      ? ""
      : pluralizeUnit(displayUnit, converted)
  const hardToMeasure =
    displayUnit === "tsp" &&
    converted.some(
      (value) =>
        compare(value, rational(0n, 1n)) > 0 &&
        compare(value, rational(1n, 8n)) < 0
    )

  return {
    text: `${qualifierText(scaled)}${approximate ? "≈" : ""}${quantityText}${unitText ? ` ${unitText}` : ""}`,
    hardToMeasure,
    approximate,
    exact: scaled,
  }
}

export function formatStructuredRecipeQuantity(
  quantity: unknown,
  authoredUnit: unknown,
  packageV1?: unknown
): FormattedRecipeQuantity | null {
  const parsedQuantity = normalizeQuantityV1(quantity)
  if (!parsedQuantity) return null
  const parsedUnit = boundedString(
    authoredUnit,
    RECIPE_QUANTITY_LIMITS.unitLength,
    true
  )
  if (parsedUnit == null) return null
  const parsedPackage = normalizePackageV1(packageV1)
  if (packageV1 !== undefined && !parsedPackage) return null
  if (parsedPackage) {
    if (!sameQuantityValue(parsedQuantity, parsedPackage.count)) return null
    return formatPackage(
      parsedQuantity,
      parsedPackage,
      rational(1n, 1n),
      false
    )
  }
  return formatScaledQuantity(parsedQuantity, parsedUnit)
}

export function formatRecipeQuantity(
  ingredient: Ingredient,
  scalingBasis: number,
  selectedYield: number
): FormattedRecipeQuantity {
  const resolved = resolveIngredientQuantity(ingredient)
  if (!resolved.quantity) {
    return {
      text: ingredient.modifier?.toLowerCase() === "to taste" ? "" : "As needed",
      hardToMeasure: false,
      approximate: false,
      exact: null,
    }
  }

  if (
    !Number.isSafeInteger(scalingBasis) ||
    scalingBasis <= 0 ||
    scalingBasis > RECIPE_QUANTITY_LIMITS.yieldValue ||
    !Number.isSafeInteger(selectedYield) ||
    selectedYield <= 0 ||
    selectedYield > RECIPE_QUANTITY_LIMITS.selectedYield
  ) {
    return {
      text: resolved.quantity.authored,
      hardToMeasure: false,
      approximate: false,
      exact: resolved.quantity,
    }
  }
  const basis = rational(BigInt(scalingBasis), 1n)
  const ratio = rational(BigInt(selectedYield), basis.numerator)
  const restoreAuthored = isOne(ratio) && resolved.provenance !== "legacy-synthesized"

  if (resolved.packageV1) {
    return formatPackage(
      resolved.quantity,
      resolved.packageV1,
      ratio,
      restoreAuthored
    )
  }
  if (restoreAuthored) {
    return {
      text: `${resolved.quantity.authored}${resolved.authoredUnit ? ` ${resolved.authoredUnit}` : ""}`,
      hardToMeasure: false,
      approximate: false,
      exact: resolved.quantity,
    }
  }
  if (
    resolved.quantity.kind === "qualitative" ||
    resolved.quantity.kind === "unparsed"
  ) {
    return {
      text: resolved.quantity.authored,
      hardToMeasure: false,
      approximate: false,
      exact: resolved.quantity,
    }
  }

  const scaled = scaleQuantity(resolved.quantity, ratio)
  return formatScaledQuantity(
    scaled,
    resolved.authoredUnit ||
      (typeof ingredient.unit === "string" ? ingredient.unit : "")
  )
}

export function getScalingBasis(
  metadata: YieldMetadataV1 | null | undefined,
  servings: number
): number {
  const parsed = normalizeYieldMetadataV1(metadata)
  const basis = parsed ? rationalToNumber(parsed.scalingBasis) : null
  const fallback =
    Number.isSafeInteger(servings) &&
    servings > 0 &&
    servings <= RECIPE_QUANTITY_LIMITS.yieldValue
      ? servings
      : 4
  return basis && Number.isSafeInteger(basis) && basis > 0 ? basis : fallback
}

export function getAuthoredYieldText(
  metadata: YieldMetadataV1 | null | undefined,
  servings: number
): string {
  const parsed = normalizeYieldMetadataV1(metadata)
  const fallback = getScalingBasis(null, servings)
  return parsed?.authoredText ||
    `${fallback} ${fallback === 1 ? "serving" : "servings"}`
}

function getYieldLabel(metadata: YieldMetadataV1 | null | undefined): string {
  const parsed = normalizeYieldMetadataV1(metadata)
  const authored = parsed?.authoredText || ""
  const label = authored.replace(
    new RegExp(
      String.raw`^(?:(?:about|approx\.?|approximately|around)\s+)?${QUANTITY_ENDPOINT}(?:\s*[-–—]\s*${QUANTITY_ENDPOINT})?\s*`,
      "i"
    ),
    ""
  ).trim()
  if (label) return label
  if (parsed?.kind === "portions") return "portions"
  if (parsed?.kind === "items") return "items"
  if (parsed?.kind === "other") return "yield"
  return "servings"
}

function inflectYieldLabel(label: string, value: number): string {
  const words = label.split(/\s+/)
  const last = words.at(-1) || label
  const lower = last.toLowerCase()
  let inflected = last
  if (value === 1) {
    if (lower === "loaves") inflected = "loaf"
    else if (lower === "people") inflected = "person"
    else if (lower.endsWith("ies")) inflected = `${last.slice(0, -3)}y`
    else if (lower.endsWith("s") && !lower.endsWith("ss")) {
      inflected = last.slice(0, -1)
    }
  } else if (lower === "loaf") {
    inflected = "loaves"
  } else if (lower === "person") {
    inflected = "people"
  } else if (!lower.endsWith("s")) {
    inflected = lower.endsWith("y")
      ? `${last.slice(0, -1)}ies`
      : `${last}s`
  }
  return [...words.slice(0, -1), inflected].join(" ")
}

export function getSelectedYieldText(
  metadata: YieldMetadataV1 | null | undefined,
  servings: number,
  selectedYield: number
): string {
  if (selectedYield === getScalingBasis(metadata, servings)) {
    return getAuthoredYieldText(metadata, servings)
  }
  return `${selectedYield} ${inflectYieldLabel(
    getYieldLabel(metadata),
    selectedYield
  )}`
}

function yieldKind(label: string): YieldKindV1 {
  const normalized = label.toLowerCase()
  if (!normalized) return "servings"
  if (/servings?|serves?|people|persons?/.test(normalized)) return "servings"
  if (/portions?/.test(normalized)) return "portions"
  if (
    /cookies?|items?|pieces?|rolls?|muffins?|cupcakes?|patties?|loaves?|bars?/.test(
      normalized
    )
  ) {
    return "items"
  }
  return "other"
}

export function parseYieldMetadata(
  authoredText: string,
  explicitBasis?: number
): YieldMetadataV1 | null {
  const text = authoredText.trim()
  if (
    text.length === 0 ||
    text.length > RECIPE_QUANTITY_LIMITS.authoredYieldLength
  ) {
    return null
  }
  const prefix = text.match(
    new RegExp(
      String.raw`^(?:(about|approx\.?|approximately|around)\s+)?(${QUANTITY_ENDPOINT})(?:\s*([-–—])\s*(${QUANTITY_ENDPOINT}))?(?:\s+(.+))?$`,
      "i"
    )
  )
  if (!prefix) return null
  const start = parseRationalLexeme(prefix[2])
  const end = prefix[4] ? parseRationalLexeme(prefix[4]) : null
  if (!start || (prefix[4] && !end)) return null
  if (
    explicitBasis !== undefined &&
    (!Number.isSafeInteger(explicitBasis) || explicitBasis <= 0)
  ) {
    return null
  }
  const basis =
    explicitBasis === undefined
      ? start
      : rationalFromIntegers(explicitBasis)
  const metadata: YieldMetadataV1 = {
    version: 1,
    authoredText: text,
    kind: yieldKind(prefix[5] || ""),
    scalingBasis: basis,
  }
  if (end) {
    metadata.range = {
      start,
      end,
      startLexeme: prefix[2],
      endLexeme: prefix[4],
      separator: prefix[3] as "-" | "–" | "—",
    }
  } else {
    metadata.value = start
  }
  return normalizeYieldMetadataV1(metadata)
}

export function normalizeYieldMetadataV1(
  value: unknown
): YieldMetadataV1 | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !hasOnlyKeys(value, [
      "version",
      "authoredText",
      "kind",
      "scalingBasis",
      "value",
      "range",
    ])
  ) {
    return null
  }
  const authoredText = boundedString(
    value.authoredText,
    RECIPE_QUANTITY_LIMITS.authoredYieldLength
  )
  const kind =
    typeof value.kind === "string" &&
    YIELD_KINDS.has(value.kind as YieldKindV1)
      ? value.kind as YieldKindV1
      : null
  const scalingBasis = normalizeRationalV1(
    value.scalingBasis,
    { positive: true }
  )
  const basisNumber = scalingBasis
    ? rationalToNumber(scalingBasis)
    : null
  if (
    !authoredText ||
    !kind ||
    !scalingBasis ||
    basisNumber == null ||
    basisNumber > RECIPE_QUANTITY_LIMITS.yieldValue
  ) {
    return null
  }

  const hasValue = value.value !== undefined
  const hasRange = value.range !== undefined
  if (hasValue === hasRange) return null

  if (hasValue) {
    const exact = normalizeRationalV1(value.value, { positive: true })
    const exactNumber = exact ? rationalToNumber(exact) : null
    return exact && exactNumber != null &&
      exactNumber <= RECIPE_QUANTITY_LIMITS.yieldValue
      ? {
          version: 1,
          authoredText,
          kind,
          scalingBasis,
          value: exact,
        }
      : null
  }

  if (
    !isRecord(value.range) ||
    !hasOnlyKeys(value.range, [
      "start",
      "end",
      "startLexeme",
      "endLexeme",
      "separator",
    ])
  ) {
    return null
  }
  const start = normalizeRationalV1(value.range.start, { positive: true })
  const end = normalizeRationalV1(value.range.end, { positive: true })
  const startLexeme = boundedString(
    value.range.startLexeme,
    RECIPE_QUANTITY_LIMITS.lexemeLength
  )
  const endLexeme = boundedString(
    value.range.endLexeme,
    RECIPE_QUANTITY_LIMITS.lexemeLength
  )
  const separator: "-" | "–" | "—" | null =
    typeof value.range.separator === "string" &&
    RANGE_SEPARATORS.has(value.range.separator)
      ? value.range.separator as "-" | "–" | "—"
      : null
  const parsedStart = start ? fromPersisted(start, { positive: true }) : null
  const parsedEnd = end ? fromPersisted(end, { positive: true }) : null
  const endNumber = end ? rationalToNumber(end) : null
  if (
    !start ||
    !end ||
    !startLexeme ||
    !endLexeme ||
    !separator ||
    !parsedStart ||
    !parsedEnd ||
    endNumber == null ||
    endNumber > RECIPE_QUANTITY_LIMITS.yieldValue ||
    compare(parsedStart, parsedEnd) > 0
  ) {
    return null
  }
  return {
    version: 1,
    authoredText,
    kind,
    scalingBasis,
    range: {
      start,
      end,
      startLexeme,
      endLexeme,
      separator,
    },
  }
}

export function isValidYieldMetadata(
  value: unknown
): value is YieldMetadataV1 {
  return Boolean(normalizeYieldMetadataV1(value))
}

export function selectedYieldRatio(
  selectedYield: number,
  scalingBasis: number
): RationalV1 {
  if (
    !Number.isSafeInteger(selectedYield) ||
    selectedYield <= 0 ||
    selectedYield > RECIPE_QUANTITY_LIMITS.selectedYield ||
    !Number.isSafeInteger(scalingBasis) ||
    scalingBasis <= 0 ||
    scalingBasis > RECIPE_QUANTITY_LIMITS.yieldValue
  ) {
    throw new Error("Selected yield is outside supported limits")
  }
  return rationalFromIntegers(selectedYield, scalingBasis)
}

/**
 * Compatibility projection for callers that still hold one legacy amount
 * field. Exact scaling and recipe formatting remain centralized here.
 */
export function scaleIngredientAmount(
  amount: Ingredient["amount"],
  originalYield: number,
  selectedYield: number
): Ingredient["amount"] {
  if (originalYield <= 0 || amount == null) return amount
  if (typeof amount === "number") {
    const authored = parseRationalLexeme(String(amount))
    if (!authored) return amount
    const scaled = multiplyRationals(
      authored,
      rationalFromIntegers(selectedYield, originalYield)
    )
    return scaled ? rationalToNumber(scaled) ?? amount : amount
  }

  const parsed = parseIngredientQuantityPrefix(amount)
  if (!parsed || parsed.confidence !== "high" || parsed.rest) return amount
  return formatRecipeQuantity(
    {
      item: "",
      amount: quantityToLegacyAmount(parsed.quantityV1),
      unit: parsed.unit,
      quantityV1: parsed.quantityV1,
      authoredUnit: parsed.authoredUnit,
      packageV1: parsed.packageV1,
    },
    originalYield,
    selectedYield
  ).text
}
