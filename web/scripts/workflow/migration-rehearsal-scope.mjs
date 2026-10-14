import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FLAGS = ["database", "parity", "canonical", "tooling"];
export const RECOVERY_MIGRATION_VERSIONS = [1, 12, 13, 14, 16, 17, 33];
const all = () => Object.fromEntries(FLAGS.map((flag) => [flag, true]));
const none = () => Object.fromEntries(FLAGS.map((flag) => [flag, false]));
const gitRead = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const workflowModules =
  /^(?:doctor|policy|state|pr-evidence|release-status|verification|migration-integrity|migration-rehearsal-scope)(?:\.test)?\.mjs$/;
const runner014 = "web/scripts/run-migration014-preflight-parity.mjs";
const runnerCanonical = "web/scripts/run-canonical-recipe-structure-migration.mjs";
const preflight014 = "scripts/database/preflight/014_add_recipe_yield_metadata.sql";
const lifecycle = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "dependencies",
];
const scriptEvents = (scripts, names) =>
  Object.fromEntries(
    names
      .flatMap((name) => [`pre${name}`, name, `post${name}`])
      .map((name) => [name, scripts?.[name]]),
  );
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

function packageInputs(source) {
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Package shape");
  return {
    common: {
      engines: value.engines,
      packageManager: value.packageManager,
      overrides: value.overrides,
      resolutions: value.resolutions,
      workspaces: value.workspaces,
      config: value.config,
      os: value.os,
      cpu: value.cpu,
      scripts: Object.fromEntries(lifecycle.map((name) => [name, value.scripts?.[name]])),
      cli: ["dependencies", "devDependencies", "optionalDependencies"].map(
        (key) => value[key]?.supabase,
      ),
    },
    parity: scriptEvents(value.scripts, ["test:migration014-preflight-parity"]),
    canonical: scriptEvents(value.scripts, ["test:canonical-recipe-structure-migration"]),
    database: scriptEvents(value.scripts, ["db:types:check", "db:types:regen:tmp"]),
    tooling: { name: value.name, private: value.private },
  };
}
// Only the CLI dependency closure is executed by these fixtures. React, client SDK,
// parser, UI and test-runner packages are not historical migration inputs.
function lockInputs(source) {
  const lock = JSON.parse(source);
  if (lock.lockfileVersion !== 3 || !lock.packages || !lock.packages[""])
    throw Error("Unrecognized lock schema");
  const graph = {};
  function visit(location) {
    if (graph[location]) return;
    const entry = lock.packages[location];
    if (!entry || Array.isArray(entry) || entry.link) throw Error("Unresolved CLI dependency");
    graph[location] = entry;
    for (const dependency of new Set(
      Object.keys({
        ...entry.dependencies,
        ...entry.optionalDependencies,
        ...entry.peerDependencies,
      }),
    )) {
      let parent = location;
      let target;
      while (parent) {
        const candidate = `${parent}/node_modules/${dependency}`;
        if (lock.packages[candidate]) {
          target = candidate;
          break;
        }
        const index = parent.lastIndexOf("/node_modules/");
        parent = index < 0 ? "" : parent.slice(0, index);
      }
      target ??= `node_modules/${dependency}`;
      if (
        !lock.packages[target] &&
        (entry.optionalDependencies?.[dependency] ||
          entry.peerDependenciesMeta?.[dependency]?.optional)
      )
        continue;
      visit(target);
    }
  }
  visit("node_modules/supabase");
  const installScripts = {};
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.link)
      throw Error("Unresolved package entry");
    if (entry.hasInstallScript) installScripts[location] = entry;
  }
  const root = lock.packages[""];
  return {
    lockfileVersion: lock.lockfileVersion,
    graph,
    installScripts,
    root: {
      engines: root.engines,
      os: root.os,
      cpu: root.cpu,
      cli: [
        root.dependencies?.supabase,
        root.devDependencies?.supabase,
        root.optionalDependencies?.supabase,
      ],
    },
  };
}

// Preserve the complete execution context; disregard only the already-tested
// scope predicates and the unrelated quality job, never setup/env/source binding.
function workflowInputs(source) {
  source = source.replace(/\r\n/g, "\n");
  if (!source.includes("\n  migration-smoke-and-drift:\n")) throw Error("DB job missing");
  return source
    .replace(/^  quality-guards:\n[\s\S]*?(?=^  migration-smoke-and-drift:)/m, "")
    .replace(
      /^        if: steps\.rehearsal-scope\.outputs\.(?:full|database|parity|canonical) != 'false'\n/gm,
      "",
    )
    .replace(
      /^        if: always\(\)(?: && steps\.rehearsal-scope\.outputs\.database != 'false')?\n/gm,
      "        if: CLEANUP\n",
    );
}

function changedInput(file, readVersions, project) {
  if (!readVersions) return true;
  try {
    const [before, after] = readVersions(file);
    if (typeof before !== "string" || typeof after !== "string" || !before || !after) return true;
    return JSON.stringify(stable(project(before))) !== JSON.stringify(stable(project(after)));
  } catch {
    return true;
  }
}

export function planDatabaseChecks(files, readVersions) {
  if (!Array.isArray(files) || files.length === 0) return all();
  const result = none();
  const select = (...flags) =>
    flags.forEach((flag) => {
      result[flag] = true;
    });
  for (const file of files) {
    if (
      typeof file !== "string" ||
      /[\\\0\r\n]/.test(file) ||
      file.split("/").some((part) => !part || part === "." || part === "..")
    )
      return all();
    if (file.endsWith(".md") || /^docs\//.test(file)) continue;
    if (file === runner014 || file === preflight014) {
      select("database", "parity");
      if (file === preflight014) select("tooling");
      continue;
    }
    if (file === runnerCanonical) {
      select("database", "canonical");
      continue;
    }
    const migration = /^supabase\/migrations\/(\d{3})_[^/]+\.sql$/.exec(file);
    if (migration) {
      const version = Number(migration[1]);
      if (!version) return all();
      select("database");
      if (RECOVERY_MIGRATION_VERSIONS.includes(version)) select("tooling");
      if (version <= 14) select("parity");
      if (version <= 17) select("canonical");
      continue;
    }
    if (["supabase/config.toml", "web/.nvmrc", ".nvmrc", ".npmrc", "web/.npmrc"].includes(file)) {
      select("database", "parity", "canonical");
      continue;
    }
    if (
      file === "web/package.json" ||
      file === "web/package-lock.json" ||
      file === ".github/workflows/ci.yml"
    ) {
      let versions;
      try {
        versions = readVersions?.(file);
        if (
          !Array.isArray(versions) ||
          versions.length !== 2 ||
          versions.some((source) => typeof source !== "string" || !source)
        )
          return all();
      } catch {
        return all();
      }
      const read = () => versions;
      const project = file.endsWith("package-lock.json")
        ? lockInputs
        : file.endsWith("package.json")
          ? packageInputs
          : workflowInputs;
      try {
        versions.forEach(project);
      } catch {
        return all();
      }
      if (file === "web/package.json") {
        if (changedInput(file, read, (source) => packageInputs(source).common))
          select("database", "parity", "canonical");
        for (const flag of ["parity", "canonical", "database", "tooling"]) {
          if (changedInput(file, read, (source) => packageInputs(source)[flag])) {
            select(flag);
            if (flag === "parity" || flag === "canonical") select("database");
          }
        }
      } else if (changedInput(file, read, project)) select("database", "parity", "canonical");
      continue;
    }
    if (file.startsWith("scripts/database/")) {
      select("tooling");
      continue;
    }
    if (
      file === ".gitignore" ||
      file === "scripts/rg-verify.ps1" ||
      file === "web/scripts/workflow/verification.mjs"
    ) {
      select("tooling");
      continue;
    }
    if (file === "supabase/verification/canonical_recipe_structure_preflight.sql") {
      select("tooling");
      continue;
    }
    if (
      /^supabase\/tests\//.test(file) ||
      [
        "supabase/verification/active_planner_reference_audit.sql",
        "supabase/verification/stage2a_uuid_reference_audit.sql",
      ].includes(file) ||
      file === "supabase/seed.sql" ||
      file === "web/src/types/database.generated.ts" ||
      file === "web/scripts/generate-db-types.mjs"
    ) {
      select("database");
      continue;
    }
    if (/^web\/(?:src|public|tests|qualification|mockup)\//.test(file)) continue;
    if (
      file.startsWith("web/scripts/workflow/") &&
      workflowModules.test(file.slice("web/scripts/workflow/".length))
    )
      continue;
    if (
      [
        runner014.replace(".mjs", ".test.mjs"),
        "web/scripts/db-preflight.mjs",
        "web/scripts/db-preflight-core.mjs",
        "web/scripts/db-preflight.test.mjs",
        ".github/workflows/combined-ui.yml",
        "supabase/migration-checksums.json",
        "web/next-env.d.ts",
        "web/tsconfig.json",
        "web/.dependency-cruiser.cjs",
        ".gitignore",
        "web/.gitignore",
      ].includes(file)
    )
      continue;
    if (
      /^web\/(?:eslint|next|postcss|tailwind|vitest|playwright(?:\.[\w-]+)?)\.config\.[cm]?[jt]s$/.test(
        file,
      )
    )
      continue;
    return all();
  }
  return result;
}

export function databaseScope(base, head, git = gitRead) {
  try {
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? "") && !/^0+$/.test(sha)))
      return all();
    for (const sha of [base, head])
      if (git(["rev-parse", "--verify", `${sha}^{commit}`]).trim() !== sha) return all();
    const output = git(["diff", "--no-renames", "--name-only", "-z", base, head, "--"]);
    if (!output.endsWith("\0")) return all();
    return planDatabaseChecks(output.slice(0, -1).split("\0"), (file) => [
      git(["show", `${base}:${file}`]),
      git(["show", `${head}:${file}`]),
    ]);
  } catch {
    return all();
  }
}

export function requiresMigrationRehearsals(files, readVersions) {
  const plan = planDatabaseChecks(files, readVersions);
  return plan.parity || plan.canonical;
}
export function rehearsalScope(base, head, git = gitRead) {
  const plan = databaseScope(base, head, git);
  return plan.parity || plan.canonical;
}
export function localMigrationToolingRequired(git = gitRead) {
  try {
    // A clean committed candidate avoids incomplete working-tree content proofs.
    if (git(["status", "--porcelain"]).trim()) return true;
    return databaseScope(
      git(["rev-parse", "--verify", "origin/main^{commit}"]).trim(),
      git(["rev-parse", "--verify", "HEAD^{commit}"]).trim(),
      git,
    ).tooling;
  } catch {
    return true;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const head = gitRead(["rev-parse", "HEAD"]).trim();
  const plan = databaseScope(process.env.REHEARSAL_BASE_SHA, head);
  if (!process.env.GITHUB_OUTPUT) throw Error("Workflow output destination required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    FLAGS.map((flag) => `${flag}=${plan[flag]}\n`).join(""),
  );
  console.log(`Database input scope: ${JSON.stringify(plan)}`);
}
