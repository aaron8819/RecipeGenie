// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECOVERY_MIGRATION_VERSIONS,
  databaseScope,
  localMigrationToolingRequired,
  planDatabaseChecks,
} from "./migration-rehearsal-scope.mjs";
const NONE = { database: false, parity: false, canonical: false, tooling: false };
const FULL = { database: true, parity: true, canonical: true, tooling: true };
const DB = { ...NONE, database: true };
const RUNTIME = { ...DB, parity: true, canonical: true };
const plan = (file, read) => planDatabaseChecks([file], read);
const versions = (a, b) => () => [JSON.stringify(a), JSON.stringify(b)];
const copy = (value) => structuredClone(value);
const pkg = {
  name: "recipe-genie",
  private: true,
  engines: { node: ">=22 <23" },
  packageManager: "npm@10.9.8",
  scripts: {
    "test:migration014-preflight-parity": "node scripts/014.mjs",
    "test:canonical-recipe-structure-migration": "node scripts/canonical.mjs",
  },
  dependencies: { react: "19", "@supabase/supabase-js": "2" },
  devDependencies: { supabase: "2.109.1" },
};
const lock = {
  lockfileVersion: 3,
  packages: {
    "": {},
    "node_modules/supabase": {
      version: "2.109.1",
      dependencies: { helper: "1" },
      optionalDependencies: { binary: "1" },
    },
    "node_modules/helper": { version: "1", integrity: "sha512-helper" },
    "node_modules/binary": { version: "1", os: ["linux"] },
    "node_modules/react": { version: "19" },
  },
};

describe("actual-input selection", () => {
  it.each([
    "AGENTS.md",
    "docs/architecture.md",
    "docs/assets/icon.png",
    "supabase/SCHEMA.md",
    "web/src/app/layout.tsx",
    "web/src/app/api/recipes/route.ts",
    "web/src/hooks/use-shopping.ts",
    "web/src/lib/recipe-structure.ts",
    "web/src/lib/supabase/client.ts",
    "web/src/components/planner/meal-planner.tsx",
    "web/src/app/globals.css",
    "web/public/manifest.json",
    "web/public/logo.svg",
    "web/tests/branding.spec.ts",
    "web/qualification/combined-ui.spec.ts",
    "web/next.config.ts",
    "web/vitest.config.ts",
    "web/playwright.combined-ui.config.ts",
    "web/scripts/workflow/migration-rehearsal-scope.mjs",
    "web/scripts/workflow/pr-evidence.mjs",
    "web/scripts/workflow/release-status.mjs",
    "web/scripts/workflow/verification.test.mjs",
    "web/scripts/db-preflight.mjs",
    ".github/workflows/combined-ui.yml",
  ])("omits unrelated DB work for %s", (file) => expect(plan(file)).toEqual(NONE));
  it.each([
    "supabase/migrations/034_new_function.sql",
    "supabase/tests/security.sql",
    "supabase/verification/active_planner_reference_audit.sql",
    "supabase/seed.sql",
    "web/src/types/database.generated.ts",
    "web/scripts/generate-db-types.mjs",
  ])("keeps current DB checks without historical work for %s", (file) =>
    expect(plan(file)).toEqual(DB),
  );
  it("maps historical prefixes and recovery fixtures independently", () => {
    expect(plan("supabase/migrations/008_old.sql")).toEqual(RUNTIME);
    expect(plan("supabase/migrations/014_add_recipe_yield_metadata.sql")).toEqual(FULL);
    expect(plan("supabase/migrations/015_dependency.sql")).toEqual({ ...DB, canonical: true });
    expect(plan("supabase/migrations/016_canonical_recipe_structure_cutover.sql")).toEqual({
      ...DB,
      canonical: true,
      tooling: true,
    });
    expect(plan("supabase/migrations/033_fix_recipe_quantity_rational_comparison.sql")).toEqual({
      ...DB,
      tooling: true,
    });
    expect(plan("scripts/database/preflight/014_add_recipe_yield_metadata.sql")).toEqual({
      ...DB,
      parity: true,
      tooling: true,
    });
    expect(plan("web/scripts/run-migration014-preflight-parity.mjs")).toEqual({
      ...DB,
      parity: true,
    });
    expect(plan("web/scripts/run-canonical-recipe-structure-migration.mjs")).toEqual({
      ...DB,
      canonical: true,
    });
    expect(plan("scripts/database/RecipeGenieBackup.Common.ps1")).toEqual({
      ...NONE,
      tooling: true,
    });
    expect(plan("scripts/rg-verify.ps1")).toEqual({ ...NONE, tooling: true });
  });
  it.each(["supabase/config.toml", "web/.nvmrc", ".npmrc"])(
    "selects shared execution risks for %s",
    (file) => expect(plan(file)).toEqual(RUNTIME),
  );
  it.each([
    "unknown.sh",
    "web/scripts/new-helper.mjs",
    "supabase/migrations/bad.sql",
    "supabase/functions/unknown.ts",
    "web/src/../scripts/unknown.mjs",
    "web\\src\\file.ts",
    "",
  ])("fails full for unknown/malformed %s", (file) => expect(plan(file)).toEqual(FULL));
  it("fails full for empty scope and combines risks", () => {
    for (const files of [[], null, [null]]) expect(planDatabaseChecks(files)).toEqual(FULL);
    expect(
      planDatabaseChecks([
        "docs/guide.md",
        "supabase/tests/security.sql",
        "scripts/database/backup.ps1",
      ]),
    ).toEqual({ ...DB, tooling: true });
  });
});

describe("content-dependent runtime inputs", () => {
  it("omits unrelated UI/client SDK dependency and build-script updates", () => {
    const after = copy(pkg);
    after.dependencies.react = "20";
    after.dependencies["@supabase/supabase-js"] = "3";
    after.scripts.build = "next build --webpack";
    expect(plan("web/package.json", versions(pkg, after))).toEqual(NONE);
    const afterLock = copy(lock);
    afterLock.packages["node_modules/react"].version = "20";
    expect(plan("web/package-lock.json", versions(lock, afterLock))).toEqual(NONE);
  });
  it.each(["cli", "engine", "packageManager", "lifecycle", "override"])(
    "selects package execution risk %s",
    (kind) => {
      const after = copy(pkg);
      if (kind === "cli") after.devDependencies.supabase = "2.110.0";
      if (kind === "engine") after.engines.node = ">=24";
      if (kind === "packageManager") after.packageManager = "npm@11";
      if (kind === "lifecycle") after.scripts.postinstall = "node setup-db.mjs";
      if (kind === "override") after.overrides = { helper: "2" };
      expect(plan("web/package.json", versions(pkg, after))).toEqual(RUNTIME);
    },
  );
  it("binds package identity to recovery tooling separately", () => {
    expect(plan("web/package.json", versions(pkg, { ...pkg, name: "wrong" }))).toEqual({
      ...NONE,
      tooling: true,
    });
  });
  it.each(["node_modules/supabase", "node_modules/helper", "node_modules/binary"])(
    "includes CLI transitive/optional input %s",
    (location) => {
      const after = copy(lock);
      after.packages[location].version = "2";
      expect(plan("web/package-lock.json", versions(lock, after))).toEqual(RUNTIME);
    },
  );
  it.each(["web/package.json", "web/package-lock.json", ".github/workflows/ci.yml"])(
    "fails full on unreadable/malformed %s",
    (file) => {
      expect(plan(file)).toEqual(FULL);
      expect(
        plan(file, () => {
          throw Error("unreadable");
        }),
      ).toEqual(FULL);
      expect(plan(file, () => ["{bad", "{}"])).toEqual(FULL);
    },
  );
  it("fails full for links, unresolved graph and unknown lock schema", () => {
    const linked = copy(lock);
    linked.packages["node_modules/helper"].link = true;
    const missing = copy(lock);
    delete missing.packages["node_modules/helper"];
    for (const after of [linked, missing, { ...lock, lockfileVersion: 1 }])
      expect(plan("web/package-lock.json", versions(lock, after))).toEqual(FULL);
  });
  it("preserves workflow execution context, disregarding only selection predicates and quality job", () => {
    const source = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const read = (after) => () => [source, after];
    expect(
      plan(".github/workflows/ci.yml", read(source.replaceAll("outputs.parity", "outputs.full"))),
    ).toEqual(NONE);
    expect(
      plan(
        ".github/workflows/ci.yml",
        read(source.replace("Run Verification Baseline", "Quality check")),
      ),
    ).toEqual(NONE);
    for (const after of [
      source.replace("version: 2.109.1", "version: 2.110.0"),
      source.replace("fetch-depth: 0", "fetch-depth: 1"),
      source.replace("run: supabase start", "run: supabase start --exclude auth"),
      source.replace(
        "  migration-smoke-and-drift:",
        "  migration-smoke-and-drift:\n    env:\n      NEW: value",
      ),
      source.replace("runs-on: ubuntu-latest\n    steps:", "runs-on: ubuntu-26.04\n    steps:"),
    ])
      expect(plan(".github/workflows/ci.yml", read(after))).toEqual(RUNTIME);
  });
});

describe("complete scope and dependency drift guards", () => {
  const base = "a".repeat(40),
    head = "b".repeat(40);
  const git =
    (files, dirty = "") =>
    (args) => {
      if (args[0] === "status") return dirty;
      if (args[0] === "rev-parse")
        return args[2].startsWith("origin/main")
          ? base
          : args[2].startsWith("HEAD")
            ? head
            : args[2].slice(0, 40);
      return files;
    };
  it("resolves NUL scope, including rename sources, and rejects incomplete reads", () => {
    expect(databaseScope(base, head, git("web/src/app/layout.tsx\0"))).toEqual(NONE);
    expect(
      databaseScope(base, head, git("supabase/migrations/014_old.sql\0web/src/new.ts\0")),
    ).toEqual(FULL);
    expect(databaseScope(base, head, git("web/src/app/layout.tsx"))).toEqual(FULL);
    expect(databaseScope("0".repeat(40), head, git(""))).toEqual(FULL);
    expect(
      databaseScope(base, head, () => {
        throw Error();
      }),
    ).toEqual(FULL);
  });
  it("selects local recovery inputs and fails safe for dirty scope", () => {
    expect(localMigrationToolingRequired(git("web/src/app/layout.tsx\0"))).toBe(false);
    expect(localMigrationToolingRequired(git("scripts/database/backup.ps1\0"))).toBe(true);
    expect(localMigrationToolingRequired(git("web/src/app/layout.tsx\0", "?? unknown"))).toBe(true);
  });
  it("requires deliberate mapping when historical runners gain imports or read inputs", () => {
    const runners = [
      [
        "run-migration014-preflight-parity.mjs",
        ["node:child_process", "node:fs", "node:url"],
        ["../scripts/database/preflight/014_add_recipe_yield_metadata.sql"],
      ],
      [
        "run-canonical-recipe-structure-migration.mjs",
        ["node:child_process", "node:fs"],
        [
          "../supabase/migrations/016_canonical_recipe_structure_cutover.sql",
          "../supabase/migrations/017_remove_legacy_recipe_structure.sql",
        ],
      ],
    ];
    for (const [file, imports, reads] of runners) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect([...source.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1])).toEqual(imports);
      expect([...source.matchAll(/readFileSync\(\s*["']([^"']+)["']/g)].map((m) => m[1])).toEqual(
        reads,
      );
      expect([...source.matchAll(/readFileSync\(/g)]).toHaveLength(reads.length);
    }
  });
  it("keeps required job identities and independent fail-safe predicates", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(workflow).toContain("  migration-smoke-and-drift:");
    for (const flag of ["parity", "canonical"])
      expect(workflow).toContain(`if: steps.rehearsal-scope.outputs.${flag} != 'false'`);
    for (const name of [
      "Setup Supabase CLI",
      "Start Local Supabase",
      "Reset Local Database",
      "Run Database Security Contracts",
      "Check Deterministic Schema-Type Drift",
    ])
      expect(workflow).toContain(
        `- name: ${name}\n        if: steps.rehearsal-scope.outputs.database != 'false'`,
      );
    expect(workflow).toContain("if: always() && steps.rehearsal-scope.outputs.database != 'false'");
  });
});

it.each([
  "pretest:migration014-preflight-parity",
  "test:migration014-preflight-parity",
  "posttest:migration014-preflight-parity",
])("maps npm event %s to parity only", (event) => {
  const after = copy(pkg);
  after.scripts[event] = "node changed.mjs";
  expect(plan("web/package.json", versions(pkg, after))).toEqual({ ...DB, parity: true });
});
it.each([
  "pretest:canonical-recipe-structure-migration",
  "test:canonical-recipe-structure-migration",
  "posttest:canonical-recipe-structure-migration",
])("maps npm event %s to canonical only", (event) => {
  const after = copy(pkg);
  after.scripts[event] = "node changed.mjs";
  expect(plan("web/package.json", versions(pkg, after))).toEqual({ ...DB, canonical: true });
});
it.each([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
])("includes npm ci lifecycle %s", (event) => {
  const after = copy(pkg);
  after.scripts[event] = "node setup.mjs";
  expect(plan("web/package.json", versions(pkg, after))).toEqual(RUNTIME);
});
it("keeps DB type-generation hooks separate from historical fixtures", () => {
  const after = copy(pkg);
  after.scripts["predb:types:regen:tmp"] = "node types.mjs";
  expect(plan("web/package.json", versions(pkg, after))).toEqual(DB);
});
it("includes added/changed lifecycle-bearing dependencies outside the CLI closure", () => {
  const before = copy(lock),
    after = copy(lock);
  after.packages["node_modules/react"].hasInstallScript = true;
  expect(plan("web/package-lock.json", versions(before, after))).toEqual(RUNTIME);
  before.packages["node_modules/react"].hasInstallScript = true;
  after.packages["node_modules/react"].version = "20";
  expect(plan("web/package-lock.json", versions(before, after))).toEqual(RUNTIME);
});
it("binds actual root install hooks and local-import assumptions to explicit map maintenance", () => {
  const actual = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  for (const event of [
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
  ])
    expect(
      actual.scripts[event],
      "New install hooks need their transitive inputs mapped",
    ).toBeUndefined();
});

it("pins recovery registry inputs so new supported migrations require classifier maintenance", () => {
  const common = readFileSync(
    new URL("../../../scripts/database/RecipeGenieBackup.Common.ps1", import.meta.url),
    "utf8",
  );
  const versions = [...common.matchAll(/'supabase\/migrations\/(\d{3})_[^']+' \{/g)].map((match) =>
    Number(match[1]),
  );
  expect([1, ...versions]).toEqual(RECOVERY_MIGRATION_VERSIONS);
  expect(
    [...common.matchAll(/PreflightPath = '(supabase\/verification\/[^']+)'/g)].map(
      (match) => match[1],
    ),
  ).toEqual(["supabase/verification/canonical_recipe_structure_preflight.sql"]);
  expect(plan("supabase/verification/canonical_recipe_structure_preflight.sql")).toEqual({
    ...NONE,
    tooling: true,
  });
  expect(plan("supabase/migration-checksums.json")).toEqual(NONE);
});

it("runs recovery safety assertions for root ignore rules without historical rehearsal", () => {
  expect(plan(".gitignore")).toEqual({ ...NONE, tooling: true });
  expect(plan("web/.gitignore")).toEqual(NONE);
});
it("fails full for unsupported array-valued lock package records", () => {
  const after = copy(lock);
  after.packages["node_modules/react"] = [];
  expect(plan("web/package-lock.json", versions(lock, after))).toEqual(FULL);
});
