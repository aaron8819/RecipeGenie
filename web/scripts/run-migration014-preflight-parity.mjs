import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...spawnOptions,
    ...options,
  })
  if (result.error) throw result.error
  return result
}

function runSupabase(args) {
  const result = run(
    supabaseRunner,
    ["supabase", "--workdir", "..", ...args],
    { stdio: "inherit" }
  )
  if (result.status !== 0) {
    throw new Error(`Supabase command failed with exit code ${result.status}`)
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
  if (result.status !== 0) throw new Error("Could not inspect local containers")
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

let restoredLatest = false
try {
  runSupabase(["db", "reset", "--local", "--version", "013", "--no-seed"])
  let container = databaseContainer()
  for (const [name, snapshot, accepted] of cases) {
    const fixture = psql(container, fixtureSql(snapshot))
    if (fixture.status !== 0) {
      throw new Error(`${name}: could not install the preflight fixture`)
    }
    const result = psql(container, preflight)
    if ((result.status === 0) !== accepted) {
      throw new Error(
        `${name}: preflight ${result.status === 0 ? "accepted" : "rejected"} unexpectedly`
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
    if (result.status !== 0) {
      throw new Error(`${name}: installed validator query failed`)
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
