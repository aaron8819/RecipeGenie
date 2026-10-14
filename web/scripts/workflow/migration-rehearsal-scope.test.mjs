// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  localMigrationToolingRequired,
  rehearsalScope,
  requiresMigrationRehearsals,
} from "./migration-rehearsal-scope.mjs";

describe("migration rehearsal scope", () => {
  it("omits only historical rehearsals for styles and inert images", () => {
    expect(
      requiresMigrationRehearsals([
        "web/src/components/planner/planner-layout.css",
        "web/src/app/globals.css",
        "web/public/recipe-genie-mark.png",
      ]),
    ).toBe(false);
  });
  it.each([
    "supabase/migrations/033.sql",
    "supabase/config.toml",
    "supabase/tests/owner.sql",
    "web/src/components/planner/meal-planner.tsx",
    "web/src/hooks/use-planner.ts",
    "web/src/lib/shopping.ts",
    "web/src/types/database.ts",
    "web/qualification/combined-ui.spec.ts",
    "web/scripts/workflow/verification.mjs",
    "scripts/database/tests/Run-Tests.ps1",
    ".github/workflows/ci.yml",
    "web/package-lock.json",
    "unknown.css",
    "web/src/components/../hooks/owner.css",
    "web/src/components/planner/../../app/globals.css",
    "web/public/logo.svg",
  ])("retains rehearsals for sensitive or unknown %s", (file) => {
    expect(requiresMigrationRehearsals(["web/src/app/globals.css", file])).toBe(
      true,
    );
  });
  it("fails closed for empty, malformed, missing or unresolved scope", () => {
    for (const files of [
      [],
      null,
      [null],
      [""],
      ["web\\src\\app\\globals.css"],
    ]) {
      expect(requiresMigrationRehearsals(files)).toBe(true);
    }
    expect(rehearsalScope("0".repeat(40), "a".repeat(40))).toBe(true);
    expect(
      rehearsalScope("a".repeat(40), "b".repeat(40), () => {
        throw Error();
      }),
    ).toBe(true);
  });
  it("includes both sides of renames and cannot hide a removed persistence file", () => {
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return args[0] === "rev-parse"
        ? `${args[2].slice(0, 40)}\n`
        : "web/src/hooks/use-planner.ts\0web/src/components/planner/new.css\0";
    };
    expect(rehearsalScope(base, head, git)).toBe(true);
    expect(calls.at(-1)).toEqual([
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      head,
      "--",
    ]);
  });
  it("requires complete resolved scope before omitting rehearsals", () => {
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const git = (args) =>
      args[0] === "rev-parse"
        ? args[2].slice(0, 40)
        : "web/src/app/globals.css\0";
    expect(rehearsalScope(base, head, git)).toBe(false);
    expect(
      rehearsalScope(base, head, (args) =>
        args[0] === "rev-parse" ? head : "",
      ),
    ).toBe(true);
    expect(
      rehearsalScope(base, head, (args) =>
        args[0] === "rev-parse"
          ? args[2].slice(0, 40)
          : "web/src/app/globals.css",
      ),
    ).toBe(true);
  });

  it("keeps required job identity and database contracts outside the conditional", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("  migration-smoke-and-drift:");
    expect(
      workflow.match(/if: steps.rehearsal-scope.outputs.full != 'false'/g),
    ).toHaveLength(2);
    expect(workflow).toContain("run: supabase test db --local supabase/tests");
    expect(workflow).toContain("run: npm run db:types:check");
    expect(workflow).toContain("run: supabase db reset --local");
  });
});

describe("proven icon and documentation scope", () => {
  const layout = "web/src/app/layout.tsx";
  const branding = "web/tests/branding.spec.ts";
  const manifest = "web/public/manifest.json";
  const source =
    'const icon = "/apple-touch-icon-v3.png"; const href = "/manifest.json?v=home-icon-v3";';
  const updated = source.replaceAll("-v3", "-v4");
  const manifestSource = JSON.stringify({
    id: "/",
    start_url: "/dashboard",
    icons: [{ src: "/pwa-icon-192-v3.png", sizes: "192x192", purpose: "any" }],
  });
  const versions = (file) =>
    file === manifest
      ? [manifestSource, manifestSource.replace("-v3", "-v4")]
      : [source, updated];

  it("omits rehearsals for the complete PR99 icon-only shape with content proof", () => {
    expect(
      requiresMigrationRehearsals(
        [
          "docs/home-screen-icon.md",
          "docs/assets/home-screen-icon-v4.png",
          "web/public/apple-touch-icon-v4.png",
          manifest,
          layout,
          branding,
        ],
        versions,
      ),
    ).toBe(false);
    expect(requiresMigrationRehearsals(["docs/component-guide.md"])).toBe(
      false,
    );
  });
  it.each([layout, branding, manifest])(
    "requires readable before/after proof for %s",
    (file) => {
      expect(requiresMigrationRehearsals([file])).toBe(true);
      for (const read of [
        () => {
          throw Error("missing");
        },
        () => ["", updated],
        () => [source, null],
        () => ["{bad", "{bad"],
      ]) {
        expect(requiresMigrationRehearsals([file], read)).toBe(true);
      }
    },
  );
  it.each([layout, branding])(
    "does not hide executable changes in %s",
    (file) => {
      for (const after of [
        updated + " await database.write();",
        updated + '\nimport { headers } from "next/headers";',
        updated.replace("const icon", "const nonce"),
        updated.replace("/apple-touch-icon-v4.png", "/unrecognized.png"),
      ]) {
        expect(requiresMigrationRehearsals([file], () => [source, after])).toBe(
          true,
        );
      }
    },
  );
  it("retains all manifest identity and non-src icon fields", () => {
    for (const after of [
      manifestSource.replace("/dashboard", "/recipes"),
      manifestSource.replace("192x192", "512x512"),
      manifestSource.replace("any", "maskable"),
    ]) {
      expect(
        requiresMigrationRehearsals([manifest], () => [manifestSource, after]),
      ).toBe(true);
    }
  });
  it.each([
    "supabase/SCHEMA.md",
    "supabase/migrations/034.sql",
    "supabase/rollback/034.sql",
    "supabase/config.toml",
    "supabase/tests/security.sql",
    "scripts/database/backup.ps1",
    "web/scripts/workflow/migration-rehearsal-scope.mjs",
    ".github/workflows/ci.yml",
    "web/src/lib/supabase/client.ts",
    "web/src/app/api/recipes/route.ts",
    "web/src/hooks/use-recipes.ts",
    "web/src/types/database.ts",
    "web/package.json",
    "web/package-lock.json",
    "web/next.config.ts",
    "docs/../supabase/config.toml",
    "docs/database.sql",
    "unknown/file.ts",
  ])("keeps the full gate when inert changes accompany %s", (file) => {
    expect(requiresMigrationRehearsals(["docs/guide.md", file], versions)).toBe(
      true,
    );
  });
  it("uses the same content proof for CI and a clean committed local candidate", () => {
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const git = (args) => {
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse")
        return args[2].startsWith("origin/main")
          ? base
          : args[2].startsWith("HEAD")
            ? head
            : args[2].slice(0, 40);
      if (args[0] === "diff")
        return `${layout}\0${manifest}\0${branding}\0docs/icon.md\0`;
      const [ref, file] = args[1].split(":");
      return versions(file)[ref === base ? 0 : 1];
    };
    expect(rehearsalScope(base, head, git)).toBe(false);
    expect(localMigrationToolingRequired(git)).toBe(false);
    expect(
      localMigrationToolingRequired((args) =>
        args[0] === "status" ? "?? unknown.ts" : git(args),
      ),
    ).toBe(true);
    expect(
      localMigrationToolingRequired(() => {
        throw Error("missing base");
      }),
    ).toBe(true);
    expect(
      rehearsalScope(base, head, (args) =>
        args[0] === "show" ? updated + "database.write()" : git(args),
      ),
    ).toBe(true);
  });
});

it("rejects malformed manifest icon entries instead of erasing their differences", () => {
  for (const icons of [[1], [null], ["icon"], [{}], []]) {
    const before = JSON.stringify({ icons });
    const after = JSON.stringify({ icons: [{ src: "/pwa-icon-192-v4.png" }] });
    expect(
      requiresMigrationRehearsals(["web/public/manifest.json"], () => [
        before,
        after,
      ]),
    ).toBe(true);
  }
});
