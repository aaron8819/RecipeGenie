import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const isWindows = process.platform === "win32"
const spawnOptions = {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: isWindows,
}
const supabaseRunner = "npx"
const preflight = readFileSync(
  "../scripts/database/preflight/014_add_recipe_yield_metadata.sql",
  "utf8"
)
const pluralValidationCategories = [
  "snapshots",
  "strings",
  "optional fields",
  "instruction groups",
  "ingredients",
  "quantities",
  "packages",
  "quantity projections",
  "units",
  "yield semantics",
]
const singularValidationCategories = [
  "rational metadata",
  "yield metadata",
]
const validationSuffix = "incompatible with migration 014 validation"
const expectedValidationRejections = new Set([
  ...pluralValidationCategories.map(
    (category) =>
      `ERROR:  pending recipe-share ${category} are ${validationSuffix}`
  ),
  ...singularValidationCategories.map(
    (category) =>
      `ERROR:  pending recipe-share ${category} is ${validationSuffix}`
  ),
])
const expectedValidationContext =
  /^CONTEXT:  PL\/pgSQL function inline_code_block line [1-9]\d* at RAISE$/

function isExpectedValidationRejection(stderr) {
  if (typeof stderr !== "string") return false

  const normalized = stderr.replace(/\r\n/g, "\n")
  const output = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized
  const lines = output.split("\n")

  if (!expectedValidationRejections.has(lines[0])) return false
  return (
    lines.length === 1 ||
    (lines.length === 2 && expectedValidationContext.test(lines[1]))
  )
}

export function classifyPreflightResult(result) {
  if (result?.error || result?.signal) return "process-failure"
  if (result?.status === 0) return "accepted"
  if (
    Number.isInteger(result?.status) &&
    result.status > 0 &&
    isExpectedValidationRejection(result?.stderr)
  ) {
    return "expected-validation-rejection"
  }
  return "unexpected-failure"
}

export function preflightResultMatchesExpectation(result, accepted) {
  const classification = classifyPreflightResult(result)
  return accepted
    ? classification === "accepted"
    : classification === "expected-validation-rejection"
}

export function formatProcessDiagnostics(result) {
  return [
    `status=${String(result?.status)}`,
    `signal=${result?.signal ?? "none"}`,
    `error=${result?.error?.message ?? "none"}`,
    `stdout:\n${result?.stdout?.trim() || "<empty>"}`,
    `stderr:\n${result?.stderr?.trim() || "<empty>"}`,
  ].join("\n")
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    ...spawnOptions,
    ...options,
  })
}

function runSupabase(args) {
  const result = run(
    supabaseRunner,
    ["supabase", "--workdir", "..", ...args],
    { stdio: "inherit" }
  )
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `Supabase command failed\n${formatProcessDiagnostics(result)}`
    )
  }
}

function databaseContainer() {
  const result = run(
    "docker",
    [
      "ps",
      "--filter",
      "label=com.supabase.cli.project",
      "--format",
      "{{.Names}}",
    ],
    { shell: false }
  )
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `Could not inspect local containers\n${formatProcessDiagnostics(result)}`
    )
  }
  const names = result.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"))
  if (names.length !== 1) {
    throw new Error(`Expected one local Supabase database, found ${names.length}`)
  }
  return names[0]
}

function psql(container, sql) {
  return run(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { shell: false, input: sql }
  )
}

const ingredient = {
  item: "sugar",
  amount: 1,
  unit: "cup",
  authoredUnit: "cups",
  quantityV1: {
    version: 1,
    kind: "exact",
    authored: "1",
    source: "authored",
    value: { numerator: "1", denominator: "1" },
    lexeme: "1",
  },
}
const validSnapshot = {
  name: "Parity fixture",
  category: "test",
  servings: 2,
  tags: ["fixture"],
  ingredients: [ingredient],
  instructions: ["Cook."],
  image_url: "",
  prep_time_minutes: 0,
  cook_time_minutes: null,
  total_time_minutes: 1,
  notes: ["Current note."],
  instruction_groups: [{ label: "Finish", steps: ["Serve."] }],
  yield_metadata: {
    version: 1,
    authoredText: "2 servings",
    kind: "servings",
    scalingBasis: { numerator: "2", denominator: "1" },
    value: { numerator: "2", denominator: "1" },
  },
}
const withValue = (key, value) => ({ ...validSnapshot, [key]: value })
const withGroup = (group) => withValue("instruction_groups", [group])
const withoutValue = (key) => {
  const value = { ...validSnapshot }
  delete value[key]
  return value
}
const withIngredient = (value) => withValue("ingredients", [value])
const legacyIngredient = {
  item: "sugar",
  amount: 1,
  unit: "cup",
}
const packageQuantity = {
  version: 1,
  kind: "exact",
  authored: "1",
  source: "authored",
  value: { numerator: "1", denominator: "1" },
  lexeme: "1",
}
const packageIngredient = {
  item: "tomatoes",
  amount: 1,
  unit: "(14 oz) can",
  authoredUnit: "(14 oz) can",
  quantityV1: packageQuantity,
  packageV1: {
    version: 1,
    count: packageQuantity,
    size: {
      value: { numerator: "14", denominator: "1" },
      lexeme: "14",
      unit: "oz",
      authoredUnit: "oz",
    },
    type: "can",
    authoredType: "can",
  },
}
const rational = (numerator, denominator) => ({
  numerator: String(numerator),
  denominator: String(denominator),
})
const withoutKey = (value, key) => {
  const result = structuredClone(value)
  delete result[key]
  return result
}
const quantityRange = {
  version: 1,
  kind: "range",
  authored: "1/2–3/4",
  source: "authored",
  start: rational(1, 2),
  end: rational(3, 4),
  startLexeme: "1/2",
  endLexeme: "3/4",
  separator: "–",
}
const withQuantityRange = (
  quantity = quantityRange,
  amount = quantity.authored
) => withIngredient({
  ...ingredient,
  amount,
  quantityV1: quantity,
})
const yieldRange = {
  start: rational(1, 2),
  end: rational(3, 4),
  startLexeme: "1/2",
  endLexeme: "3/4",
  separator: "–",
}
const yieldRangeMetadata = {
  version: 1,
  authoredText: "1/2–3/4 servings",
  kind: "servings",
  scalingBasis: rational(1, 2),
  range: yieldRange,
}
const withYieldRange = (metadata = yieldRangeMetadata) =>
  withValue("yield_metadata", metadata)
const cases = [
  ["legacy empty snapshot", {}, true],
  ["top-level JSON null", null, false],
  ["top-level array", [], false],
  ["top-level string scalar", "snapshot", false],
  ["top-level number scalar", 2, false],
  ["top-level boolean", false, false],
  ["malformed nonempty object", { name: "Incomplete" }, false],
  [
    "valid complete legacy structured snapshot",
    {
      name: "Legacy parity fixture",
      category: "test",
      servings: 2,
      tags: [],
      ingredients: [legacyIngredient],
      instructions: [],
    },
    true,
  ],
  ["valid current snapshot", validSnapshot, true],
  [
    "empty required arrays are permitted",
    {
      ...validSnapshot,
      tags: [],
      ingredients: [],
      instructions: [],
    },
    true,
  ],
  ["optional yield metadata absent", withoutValue("yield_metadata"), true],
  ["optional yield metadata null", withValue("yield_metadata", null), true],
  ["optional quantity and package metadata absent", withIngredient(legacyIngredient), true],
  ["valid package metadata", withIngredient(packageIngredient), true],
  [
    "quantity version missing",
    withIngredient({
      ...ingredient,
      quantityV1: {
        kind: "exact",
        authored: "1",
        source: "authored",
        value: { numerator: "1", denominator: "1" },
        lexeme: "1",
      },
    }),
    false,
  ],
  [
    "quantity version null",
    withIngredient({
      ...ingredient,
      quantityV1: { ...ingredient.quantityV1, version: null },
    }),
    false,
  ],
  [
    "quantity version unsupported",
    withIngredient({
      ...ingredient,
      quantityV1: { ...ingredient.quantityV1, version: 2 },
    }),
    false,
  ],
  [
    "package version missing",
    withIngredient({
      ...packageIngredient,
      packageV1: {
        count: packageQuantity,
        size: packageIngredient.packageV1.size,
        type: "can",
        authoredType: "can",
      },
    }),
    false,
  ],
  [
    "package version unsupported",
    withIngredient({
      ...packageIngredient,
      packageV1: { ...packageIngredient.packageV1, version: 2 },
    }),
    false,
  ],
  [
    "package size lexeme mismatch",
    withIngredient({
      ...packageIngredient,
      packageV1: {
        ...packageIngredient.packageV1,
        size: { ...packageIngredient.packageV1.size, lexeme: "9" },
      },
    }),
    false,
  ],
  [
    "yield version missing",
    withValue("yield_metadata", {
      authoredText: "2 servings",
      kind: "servings",
      scalingBasis: { numerator: "2", denominator: "1" },
      value: { numerator: "2", denominator: "1" },
    }),
    false,
  ],
  [
    "yield version null",
    withValue("yield_metadata", {
      ...validSnapshot.yield_metadata,
      version: null,
    }),
    false,
  ],
  [
    "yield version unsupported",
    withValue("yield_metadata", {
      ...validSnapshot.yield_metadata,
      version: 2,
    }),
    false,
  ],
  [
    "yield authored value mismatch",
    withValue("yield_metadata", {
      ...validSnapshot.yield_metadata,
      authoredText: "9 servings",
    }),
    false,
  ],
  ["valid null instruction groups", withValue("instruction_groups", null), true],
  ["valid empty instruction groups", withValue("instruction_groups", []), true],
  [
    "maximum instruction group array",
    withValue(
      "instruction_groups",
      Array.from({ length: 500 }, () => ({ steps: [] }))
    ),
    true,
  ],
  [
    "maximum instruction step array",
    withGroup({ steps: Array.from({ length: 2000 }, () => "step") }),
    true,
  ],
  ["maximum group label", withGroup({ label: "x".repeat(128), steps: [] }), true],
  ["maximum step string", withGroup({ steps: ["x".repeat(10000)] }), true],
  ["instruction groups boolean", withValue("instruction_groups", true), false],
  ["instruction groups object", withValue("instruction_groups", {}), false],
  ["instruction groups scalar", withValue("instruction_groups", "bad"), false],
  ["null group", withGroup(null), false],
  ["array group", withGroup([]), false],
  ["scalar group", withGroup("bad"), false],
  ["unsupported group field", withGroup({ steps: [], name: "bad" }), false],
  ["missing steps", withGroup({ label: "Bad" }), false],
  ["null steps", withGroup({ steps: null }), false],
  ["object steps", withGroup({ steps: {} }), false],
  ["string steps", withGroup({ steps: "bad" }), false],
  ["boolean steps", withGroup({ steps: true }), false],
  [
    "oversized group array",
    withValue(
      "instruction_groups",
      Array.from({ length: 501 }, () => ({ steps: [] }))
    ),
    false,
  ],
  [
    "oversized step array",
    withGroup({ steps: Array.from({ length: 2001 }, () => "step") }),
    false,
  ],
  ["null group label", withGroup({ label: null, steps: [] }), false],
  ["empty group label", withGroup({ label: "", steps: [] }), false],
  ["oversized group label", withGroup({ label: "x".repeat(129), steps: [] }), false],
  ["object step", withGroup({ steps: [{}] }), false],
  ["oversized step string", withGroup({ steps: ["x".repeat(10001)] }), false],
  ["null image URL", withValue("image_url", null), true],
  ["maximum image URL", withValue("image_url", "x".repeat(8192)), true],
  ["invalid image URL", withValue("image_url", {}), false],
  ["oversized image URL", withValue("image_url", "x".repeat(8193)), false],
  ["invalid recipe name", withValue("name", ""), false],
  ["invalid tags", withValue("tags", [true]), false],
  ["invalid instructions", withValue("instructions", [{}]), false],
  ["invalid time", withValue("prep_time_minutes", -1), false],
  ["invalid notes", withValue("notes", [null]), false],
  [
    "rational 1/1 versus authored lexeme 9",
    {
      ...validSnapshot,
      ingredients: [{
        ...ingredient,
        amount: 1,
        quantityV1: {
          ...ingredient.quantityV1,
          authored: "9",
          lexeme: "9",
        },
      }],
    },
    false,
  ],
]

const quantityRangeCases = [
  [
    "quantity range valid fractional hyphen endpoints",
    withQuantityRange({
      ...quantityRange,
      authored: "1/2-3/4",
      separator: "-",
    }),
    true,
  ],
  [
    "quantity range valid mixed-number en dash endpoints",
    withQuantityRange({
      ...quantityRange,
      authored: "1 1/2–2 1/4",
      start: rational(3, 2),
      end: rational(9, 4),
      startLexeme: "1 1/2",
      endLexeme: "2 1/4",
    }),
    true,
  ],
  [
    "quantity range valid decimal em dash endpoints",
    withQuantityRange({
      ...quantityRange,
      authored: "0.5—1.25",
      end: rational(5, 4),
      startLexeme: "0.5",
      endLexeme: "1.25",
      separator: "—",
    }),
    true,
  ],
  [
    "quantity range valid Unicode-fraction endpoints",
    withQuantityRange({
      ...quantityRange,
      authored: "½–1½",
      end: rational(3, 2),
      startLexeme: "½",
      endLexeme: "1½",
    }),
    true,
  ],
  [
    "quantity range valid authored qualifier",
    withQuantityRange({
      ...quantityRange,
      authored: "about 1/2–3/4",
      qualifier: "about",
    }),
    true,
  ],
  [
    "quantity range equal endpoints are permitted",
    withQuantityRange({
      ...quantityRange,
      authored: "1–1",
      start: rational(1, 1),
      end: rational(1, 1),
      startLexeme: "1",
      endLexeme: "1",
    }),
    true,
  ],
  [
    "quantity range valid original-text source",
    withQuantityRange({
      ...quantityRange,
      source: "original-text",
    }),
    true,
  ],
  [
    "quantity range missing version",
    withQuantityRange(withoutKey(quantityRange, "version")),
    false,
  ],
  [
    "quantity range missing kind",
    withQuantityRange(withoutKey(quantityRange, "kind")),
    false,
  ],
  [
    "quantity range missing authored text",
    withQuantityRange(
      withoutKey(quantityRange, "authored"),
      quantityRange.authored
    ),
    false,
  ],
  [
    "quantity range missing source",
    withQuantityRange(withoutKey(quantityRange, "source")),
    false,
  ],
  [
    "quantity range unsupported source",
    withQuantityRange({ ...quantityRange, source: "imported" }),
    false,
  ],
  [
    "quantity range missing start",
    withQuantityRange(withoutKey(quantityRange, "start")),
    false,
  ],
  [
    "quantity range missing end",
    withQuantityRange(withoutKey(quantityRange, "end")),
    false,
  ],
  [
    "quantity range missing start lexeme",
    withQuantityRange(withoutKey(quantityRange, "startLexeme")),
    false,
  ],
  [
    "quantity range missing end lexeme",
    withQuantityRange(withoutKey(quantityRange, "endLexeme")),
    false,
  ],
  [
    "quantity range missing separator",
    withQuantityRange(withoutKey(quantityRange, "separator")),
    false,
  ],
  [
    "quantity range start is JSON null",
    withQuantityRange({ ...quantityRange, start: null }),
    false,
  ],
  [
    "quantity range end has incorrect type",
    withQuantityRange({ ...quantityRange, end: "3/4" }),
    false,
  ],
  [
    "quantity range start lexeme is JSON null",
    withQuantityRange({ ...quantityRange, startLexeme: null }),
    false,
  ],
  [
    "quantity range end lexeme has incorrect type",
    withQuantityRange({ ...quantityRange, endLexeme: 0.75 }),
    false,
  ],
  [
    "quantity range separator has incorrect type",
    withQuantityRange({ ...quantityRange, separator: ["–"] }),
    false,
  ],
  [
    "quantity range unsupported separator",
    withQuantityRange({ ...quantityRange, separator: "/" }),
    false,
  ],
  [
    "quantity range malformed start rational",
    withQuantityRange({
      ...quantityRange,
      start: rational(1, 0),
    }),
    false,
  ],
  [
    "quantity range malformed end rational",
    withQuantityRange({
      ...quantityRange,
      end: { numerator: "3" },
    }),
    false,
  ],
  [
    "quantity range malformed authored start lexeme",
    withQuantityRange({
      ...quantityRange,
      authored: "one–3/4",
    }, quantityRange.authored),
    false,
  ],
  [
    "quantity range malformed authored end lexeme",
    withQuantityRange({
      ...quantityRange,
      authored: "1/2–three quarters",
    }, quantityRange.authored),
    false,
  ],
  [
    "quantity range start rational disagrees with lexeme",
    withQuantityRange({
      ...quantityRange,
      start: rational(1, 3),
    }),
    false,
  ],
  [
    "quantity range end rational disagrees with lexeme",
    withQuantityRange({
      ...quantityRange,
      end: rational(2, 3),
    }),
    false,
  ],
  [
    "quantity range authored start disagrees with stored lexeme",
    withQuantityRange({
      ...quantityRange,
      start: rational(1, 3),
      startLexeme: "1/3",
    }),
    false,
  ],
  [
    "quantity range authored separator disagrees with stored separator",
    withQuantityRange({
      ...quantityRange,
      separator: "-",
    }),
    false,
  ],
  [
    "quantity range authored end disagrees with stored lexeme",
    withQuantityRange({
      ...quantityRange,
      end: rational(2, 3),
      endLexeme: "2/3",
    }),
    false,
  ],
  [
    "quantity range descending endpoints",
    withQuantityRange({
      ...quantityRange,
      authored: "2–1",
      start: rational(2, 1),
      end: rational(1, 1),
      startLexeme: "2",
      endLexeme: "1",
    }),
    false,
  ],
  [
    "quantity range extra structure",
    withQuantityRange({ ...quantityRange, midpoint: rational(5, 8) }),
    false,
  ],
  [
    "quantity range metadata is JSON null",
    withIngredient({ ...ingredient, amount: "1/2–3/4", quantityV1: null }),
    false,
  ],
  [
    "quantity range metadata has unsupported array shape",
    withIngredient({ ...ingredient, amount: "1/2–3/4", quantityV1: [] }),
    false,
  ],
  [
    "quantity range legacy projection is malformed",
    withQuantityRange(quantityRange, "1/2 to 3/4"),
    false,
  ],
  [
    "quantity range legacy projection endpoints disagree",
    withQuantityRange(quantityRange, "1/2–1"),
    false,
  ],
  [
    "quantity range qualifier disagrees with authored qualifier",
    withQuantityRange({ ...quantityRange, qualifier: "around" }),
    false,
  ],
]

const yieldRangeCases = [
  [
    "yield range valid fractional hyphen endpoints",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1/2-3/4 portions",
      kind: "portions",
      range: { ...yieldRange, separator: "-" },
    }),
    true,
  ],
  [
    "yield range valid mixed-number en dash endpoints",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1 1/2–2 1/4 servings",
      scalingBasis: rational(3, 2),
      range: {
        ...yieldRange,
        start: rational(3, 2),
        end: rational(9, 4),
        startLexeme: "1 1/2",
        endLexeme: "2 1/4",
      },
    }),
    true,
  ],
  [
    "yield range valid decimal em dash endpoints",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "0.5—1.25 cups",
      kind: "other",
      range: {
        ...yieldRange,
        end: rational(5, 4),
        startLexeme: "0.5",
        endLexeme: "1.25",
        separator: "—",
      },
    }),
    true,
  ],
  [
    "yield range valid Unicode-fraction endpoints",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "½–1½ servings",
      range: {
        ...yieldRange,
        end: rational(3, 2),
        startLexeme: "½",
        endLexeme: "1½",
      },
    }),
    true,
  ],
  [
    "yield range valid authored qualifier",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "about 1/2–3/4 servings",
    }),
    true,
  ],
  [
    "yield range equal endpoints are permitted",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "2–2 items",
      kind: "items",
      scalingBasis: rational(2, 1),
      range: {
        ...yieldRange,
        start: rational(2, 1),
        end: rational(2, 1),
        startLexeme: "2",
        endLexeme: "2",
      },
    }),
    true,
  ],
  [
    "yield range missing version",
    withYieldRange(withoutKey(yieldRangeMetadata, "version")),
    false,
  ],
  [
    "yield range missing authored text",
    withYieldRange(withoutKey(yieldRangeMetadata, "authoredText")),
    false,
  ],
  [
    "yield range missing kind",
    withYieldRange(withoutKey(yieldRangeMetadata, "kind")),
    false,
  ],
  [
    "yield range missing scaling basis",
    withYieldRange(withoutKey(yieldRangeMetadata, "scalingBasis")),
    false,
  ],
  [
    "yield range missing start",
    withYieldRange({
      ...yieldRangeMetadata,
      range: withoutKey(yieldRange, "start"),
    }),
    false,
  ],
  [
    "yield range missing end",
    withYieldRange({
      ...yieldRangeMetadata,
      range: withoutKey(yieldRange, "end"),
    }),
    false,
  ],
  [
    "yield range missing start lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: withoutKey(yieldRange, "startLexeme"),
    }),
    false,
  ],
  [
    "yield range missing end lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: withoutKey(yieldRange, "endLexeme"),
    }),
    false,
  ],
  [
    "yield range missing separator",
    withYieldRange({
      ...yieldRangeMetadata,
      range: withoutKey(yieldRange, "separator"),
    }),
    false,
  ],
  [
    "yield range is JSON null",
    withYieldRange({ ...yieldRangeMetadata, range: null }),
    false,
  ],
  [
    "yield range has unsupported array shape",
    withYieldRange({ ...yieldRangeMetadata, range: [] }),
    false,
  ],
  [
    "yield range start is JSON null",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, start: null },
    }),
    false,
  ],
  [
    "yield range end has incorrect type",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, end: "3/4" },
    }),
    false,
  ],
  [
    "yield range start lexeme is JSON null",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, startLexeme: null },
    }),
    false,
  ],
  [
    "yield range end lexeme has incorrect type",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, endLexeme: 0.75 },
    }),
    false,
  ],
  [
    "yield range separator has incorrect type",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, separator: ["–"] },
    }),
    false,
  ],
  [
    "yield range unsupported separator",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, separator: "/" },
    }),
    false,
  ],
  [
    "yield range malformed start rational",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, start: rational(1, 0) },
    }),
    false,
  ],
  [
    "yield range malformed end rational",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, end: { numerator: "3" } },
    }),
    false,
  ],
  [
    "yield range malformed authored start lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "one–3/4 servings",
    }),
    false,
  ],
  [
    "yield range malformed authored end lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1/2–three quarters servings",
    }),
    false,
  ],
  [
    "yield range start rational disagrees with lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, start: rational(1, 3) },
    }),
    false,
  ],
  [
    "yield range end rational disagrees with lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, end: rational(2, 3) },
    }),
    false,
  ],
  [
    "yield range authored start disagrees with stored lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: {
        ...yieldRange,
        start: rational(1, 3),
        startLexeme: "1/3",
      },
    }),
    false,
  ],
  [
    "yield range authored separator disagrees with stored separator",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, separator: "-" },
    }),
    false,
  ],
  [
    "yield range authored end disagrees with stored lexeme",
    withYieldRange({
      ...yieldRangeMetadata,
      range: {
        ...yieldRange,
        end: rational(2, 3),
        endLexeme: "2/3",
      },
    }),
    false,
  ],
  [
    "yield range descending endpoints",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "2–1 servings",
      scalingBasis: rational(2, 1),
      range: {
        ...yieldRange,
        start: rational(2, 1),
        end: rational(1, 1),
        startLexeme: "2",
        endLexeme: "1",
      },
    }),
    false,
  ],
  [
    "yield range extra nested structure",
    withYieldRange({
      ...yieldRangeMetadata,
      range: { ...yieldRange, midpoint: rational(5, 8) },
    }),
    false,
  ],
  [
    "yield range extra top-level structure",
    withYieldRange({ ...yieldRangeMetadata, label: "servings" }),
    false,
  ],
  [
    "yield range and exact value both present",
    withYieldRange({
      ...yieldRangeMetadata,
      value: rational(1, 2),
    }),
    false,
  ],
  [
    "yield range and exact value both absent",
    withYieldRange(withoutKey(yieldRangeMetadata, "range")),
    false,
  ],
  [
    "yield range object paired with exact authored text",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1/2 servings",
    }),
    false,
  ],
  [
    "yield range authored text paired with exact value shape",
    withYieldRange({
      ...withoutKey(yieldRangeMetadata, "range"),
      value: rational(1, 2),
    }),
    false,
  ],
  [
    "yield range label disagrees with kind",
    withYieldRange({ ...yieldRangeMetadata, kind: "items" }),
    false,
  ],
  [
    "yield range scaling basis is JSON null",
    withYieldRange({ ...yieldRangeMetadata, scalingBasis: null }),
    false,
  ],
  [
    "yield range endpoint is zero",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "0–3/4 servings",
      scalingBasis: rational(1, 2),
      range: {
        ...yieldRange,
        start: rational(0, 1),
        startLexeme: "0",
      },
    }),
    false,
  ],
  [
    "yield range endpoint exceeds maximum",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1/2–10001 servings",
      range: {
        ...yieldRange,
        end: rational(10001, 1),
        endLexeme: "10001",
      },
    }),
    false,
  ],
]

const quantityBranchCases = [
  [
    "quantity range valid around qualifier",
    withQuantityRange({
      ...quantityRange,
      authored: "around 1/2–3/4",
      qualifier: "around",
    }),
    true,
  ],
  [
    "quantity range valid approx qualifier",
    withQuantityRange({
      ...quantityRange,
      authored: "approx 1/2–3/4",
      qualifier: "approximately",
    }),
    true,
  ],
  [
    "quantity range valid approx-dot qualifier",
    withQuantityRange({
      ...quantityRange,
      authored: "approx. 1/2–3/4",
      qualifier: "approximately",
    }),
    true,
  ],
  [
    "quantity range valid approximately qualifier",
    withQuantityRange({
      ...quantityRange,
      authored: "approximately 1/2–3/4",
      qualifier: "approximately",
    }),
    true,
  ],
  [
    "quantity range valid legacy-synthesized source",
    withQuantityRange({
      ...quantityRange,
      source: "legacy-synthesized",
    }),
    true,
  ],
  [
    "quantity range kind has incorrect type",
    withQuantityRange({ ...quantityRange, kind: ["range"] }),
    false,
  ],
  [
    "quantity range authored text has incorrect type",
    withQuantityRange(
      { ...quantityRange, authored: ["1/2–3/4"] },
      quantityRange.authored
    ),
    false,
  ],
  [
    "quantity range source has incorrect type",
    withQuantityRange({ ...quantityRange, source: { type: "authored" } }),
    false,
  ],
  [
    "quantity range qualifier has incorrect type",
    withQuantityRange({
      ...quantityRange,
      authored: "about 1/2–3/4",
      qualifier: true,
    }),
    false,
  ],
  [
    "quantity range start rational has extra key",
    withQuantityRange({
      ...quantityRange,
      start: { ...quantityRange.start, reduced: true },
    }),
    false,
  ],
]

const yieldBoundaryCases = [
  [
    "yield range scaling basis is zero",
    withYieldRange({
      ...yieldRangeMetadata,
      scalingBasis: rational(0, 1),
    }),
    false,
  ],
  [
    "yield range scaling basis exceeds maximum",
    withYieldRange({
      ...yieldRangeMetadata,
      scalingBasis: rational(10001, 1),
    }),
    false,
  ],
  [
    "yield range endpoint accepts inclusive maximum",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "9999–10000 servings",
      scalingBasis: rational(9999, 1),
      range: {
        ...yieldRange,
        start: rational(9999, 1),
        end: rational(10000, 1),
        startLexeme: "9999",
        endLexeme: "10000",
      },
    }),
    true,
  ],
  [
    "yield range scaling basis accepts inclusive maximum",
    withYieldRange({
      ...yieldRangeMetadata,
      authoredText: "1–2 servings",
      scalingBasis: rational(10000, 1),
      range: {
        ...yieldRange,
        start: rational(1, 1),
        end: rational(2, 1),
        startLexeme: "1",
        endLexeme: "2",
      },
    }),
    true,
  ],
]

const requiredFields = [
  "name",
  "category",
  "servings",
  "tags",
  "ingredients",
  "instructions",
]
for (const field of requiredFields) {
  cases.push([`required ${field} missing`, withoutValue(field), false])
  cases.push([`required ${field} is JSON null`, withValue(field, null), false])
}

const invalidRequiredTypes = {
  name: [false, [], {}],
  category: [false, [], {}],
  servings: ["2", [], {}],
  tags: ["tags", [true], {}],
  ingredients: ["ingredients", [true], {}],
  instructions: ["instructions", [true], {}],
}
for (const [field, values] of Object.entries(invalidRequiredTypes)) {
  for (const [index, value] of values.entries()) {
    cases.push([
      `required ${field} invalid type ${index + 1}`,
      withValue(field, value),
      false,
    ])
  }
}

cases.push(
  ...quantityRangeCases,
  ...yieldRangeCases,
  ...quantityBranchCases,
  ...yieldBoundaryCases
)

if (
  cases.length !== 185 ||
  quantityRangeCases.length !== 39 ||
  yieldRangeCases.length !== 43 ||
  quantityBranchCases.length !== 10 ||
  yieldBoundaryCases.length !== 4
) {
  throw new Error("Migration 014 parity fixture count changed unexpectedly")
}
if (
  new Set(cases.map(([name]) => name)).size !== cases.length ||
  cases.some(([, , accepted]) => typeof accepted !== "boolean")
) {
  throw new Error("Migration 014 parity fixture metadata is invalid")
}

function fixtureSql(snapshot) {
  const encoded = JSON.stringify(snapshot)
  return `
insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'preflight-a@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'preflight-b@example.test')
on conflict (id) do nothing;
insert into public.recipes (
  id, user_id, name, category, servings, tags, ingredients, instructions
) values (
  'preflight-fixture',
  '10000000-0000-0000-0000-000000000001',
  'Preflight source',
  'test',
  2,
  '{}'::text[],
  '[]'::jsonb,
  '{}'::text[]
)
on conflict (id) do nothing;
delete from public.recipe_shares;
insert into public.recipe_shares (
  id, sender_user_id, sender_email, recipient_user_id, recipient_email,
  source_recipe_id, source_recipe_snapshot
) values (
  'a1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'preflight-a@example.test',
  '20000000-0000-0000-0000-000000000002',
  'preflight-b@example.test',
  'preflight-fixture',
  $snapshot$${encoded}$snapshot$::jsonb
);
`
}

function main() {
  let restoredLatest = false
  try {
    runSupabase(["db", "reset", "--local", "--version", "013", "--no-seed"])
    let container = databaseContainer()
    for (const [name, snapshot, accepted] of cases) {
      const fixture = psql(container, fixtureSql(snapshot))
      if (fixture.error || fixture.signal || fixture.status !== 0) {
        throw new Error(
          `${name}: could not install the preflight fixture\n` +
          formatProcessDiagnostics(fixture)
        )
      }
      const result = psql(container, preflight)
      if (!preflightResultMatchesExpectation(result, accepted)) {
        throw new Error(
          `${name}: preflight result classified as ` +
          `${classifyPreflightResult(result)}, expected ` +
          `${accepted ? "acceptance" : "migration-014 validation rejection"}\n` +
          formatProcessDiagnostics(result)
        )
      }
    }

    runSupabase(["db", "reset", "--local", "--no-seed"])
    restoredLatest = true
    container = databaseContainer()
    for (const [name, snapshot, accepted] of cases) {
      const encoded = JSON.stringify(snapshot)
      const result = psql(
        container,
        `select private.recipe_share_snapshot_is_valid($snapshot$${encoded}$snapshot$::jsonb);\n`
      )
      if (result.error || result.signal || result.status !== 0) {
        throw new Error(
          `${name}: installed validator query failed\n` +
          formatProcessDiagnostics(result)
        )
      }
      const actual = result.stdout.trim().split(/\r?\n/).at(-1)?.trim()
      const expected = accepted ? "t" : "f"
      if (actual !== expected) {
        throw new Error(
          `${name}: installed validator returned ${actual}, expected ${expected}`
        )
      }
    }
  } finally {
    if (!restoredLatest) {
      runSupabase(["db", "reset", "--local", "--no-seed"])
    }
  }

  console.log(
    `Migration 014 preflight parity passed for ${cases.length} complete-snapshot fixtures.`
  )
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main()
}
