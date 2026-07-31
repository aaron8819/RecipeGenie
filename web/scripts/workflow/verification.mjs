import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertSafeOutput, assertSecretSafe } from "./state.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..", "..")
const repositoryRoot = resolve(webDirectory, "..")
const npmCli = process.env.npm_execpath
  ?? resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")

function npmCheck(name, args, coverage) {
  return {
    name,
    command: process.execPath,
    args: [npmCli, ...args],
    coverage,
  }
}

const MIGRATION_CHECK = Object.freeze({
  name: "migration-reference-integrity",
  command: process.execPath,
  args: [resolve(scriptDirectory, "migration-integrity.mjs")],
  coverage: "Validated tracked migration files, checksum coverage, checksums, active endpoint, and documented chain.",
})

const PR_CHECKS = Object.freeze([
  npmCheck(
    "repository-verification",
    ["run", "verify"],
    "Ran artifact and secret guards, migration-reference integrity, lint, typecheck, unit tests, error/skip guards, identity/write guards, and cycle analysis.",
  ),
  npmCheck(
    "production-build",
    ["run", "build"],
    "Ran the production Next.js build.",
  ),
  {
    name: "migration-tooling-tests",
    command: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      resolve(repositoryRoot, "scripts", "database", "tests", "Run-Tests.ps1"),
    ],
    coverage: "Ran the repository's PowerShell migration backup, assertion, and preflight tooling tests.",
  },
])

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "")
}

function check(name, status, detail, command = null) {
  return { name, status, detail, command }
}

function commandLabel(command, args) {
  return [command, ...args].join(" ")
}

function defaultCommandRunner(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  }
}

function runCheck(definition, commandRunner, cwd = webDirectory) {
  const startedAt = Date.now()
  const result = commandRunner(
    definition.command,
    definition.args,
    definition.cwd ?? cwd,
  )
  const label = commandLabel(definition.command, definition.args)
  if (result.exitCode === 0 && !result.error) {
    return check(
      definition.name,
      "PASS",
      `${definition.coverage ?? "Check completed."} Duration: ${Date.now() - startedAt} ms.`,
      label,
    )
  }
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .slice(-12_000)
  return {
    ...check(
      definition.name,
      "FAIL",
      result.error
        ? `Could not run check: ${result.error}`
        : `Exited ${result.exitCode} after ${Date.now() - startedAt} ms.`,
      label,
    ),
    output,
  }
}

function isDocumentationPath(path) {
  return path === "README.md"
    || path === "AGENTS.md"
    || path === "CLAUDE.md"
    || path === "supabase/SCHEMA.md"
    || path.startsWith("docs/")
    || (path.startsWith("scripts/database/") && path.endsWith(".md"))
}

function focusedCategory(path) {
  if (isDocumentationPath(path)) return "documentation"
  if (/^web\/scripts\/workflow\/[^/]+\.mjs$/u.test(path)) return "workflow"
  if (
    /^web\/scripts\/db-preflight(?:-core)?(?:\.test)?\.mjs$/u.test(path)
    || path.startsWith("web/scripts/fixtures/db-preflight/")
  ) return "db-preflight"
  if (path === "supabase/migration-checksums.json") return "migration-metadata"
  return null
}

export function planFocusedVerification(changedFiles) {
  const files = [...new Set(changedFiles.map(normalizePath))].sort()
  if (files.length === 0) {
    return {
      files,
      escalated: false,
      categories: [],
      checks: [],
      detail: "No changed files were found for the explicit scope.",
    }
  }

  const categories = files.map(focusedCategory)
  const unknownFiles = files.filter((_, index) => !categories[index])
  if (unknownFiles.length > 0) {
    return {
      files,
      escalated: true,
      categories: [...new Set(categories.filter(Boolean))].sort(),
      checks: PR_CHECKS,
      detail: `Scope includes paths without a safe focused mapping: ${unknownFiles.join(", ")}.`,
    }
  }

  const uniqueCategories = [...new Set(categories)].sort()
  const checks = [MIGRATION_CHECK]
  if (uniqueCategories.includes("workflow")) {
    checks.push(npmCheck(
      "workflow-unit-tests",
      ["run", "test", "--", "--run", "scripts/workflow"],
      "Ran every workflow-script unit test.",
    ))
    checks.push(npmCheck(
      "workflow-lint",
      ["exec", "--", "eslint", "scripts/workflow/*.mjs"],
      "Linted every workflow script and workflow test.",
    ))
  }
  if (uniqueCategories.includes("db-preflight")) {
    checks.push(npmCheck(
      "db-preflight-unit-tests",
      [
        "run",
        "test",
        "--",
        "--run",
        "scripts/db-preflight.test.mjs",
      ],
      "Ran the canonical database-preflight unit tests.",
    ))
    checks.push(npmCheck(
      "db-preflight-lint",
      [
        "exec",
        "--",
        "eslint",
        "scripts/db-preflight.mjs",
        "scripts/db-preflight-core.mjs",
        "scripts/db-preflight.test.mjs",
      ],
      "Linted the database-preflight implementation and tests.",
    ))
  }

  return {
    files,
    escalated: false,
    categories: uniqueCategories,
    checks,
    detail: `Focused mapping selected ${checks.length} check(s) for ${files.length} changed file(s).`,
  }
}

function gitChangedFiles(base, commandRunner) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}^~:-]*$/u.test(base ?? "")) {
    return { files: [], unknown: true, detail: "Base/ref format is invalid." }
  }
  const verified = commandRunner(
    "git",
    ["rev-parse", "--verify", `${base}^{commit}`],
    repositoryRoot,
  )
  if (verified.exitCode !== 0) {
    return { files: [], unknown: true, detail: `Base/ref ${base} could not be resolved.` }
  }
  const changed = commandRunner(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, "--"],
    repositoryRoot,
  )
  const untracked = commandRunner(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    repositoryRoot,
  )
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) {
    return { files: [], unknown: true, detail: "Changed-file scope could not be determined." }
  }
  return {
    files: [changed.stdout, untracked.stdout]
      .join("\n")
      .split(/\r?\n/u)
      .filter(Boolean),
    unknown: false,
    detail: `Changed files resolved against ${base}.`,
  }
}

function finishReport(report) {
  const failed = report.checks.some((item) => item.status === "FAIL")
  report.status = failed ? "FAIL" : "PASS"
  assertSecretSafe(report, "verification report")
  return report
}

export function runPrVerification(options = {}) {
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const checks = PR_CHECKS.map((definition) => runCheck(
    definition,
    commandRunner,
  ))
  return finishReport({
    schemaVersion: 1,
    requestedTier: "PR",
    effectiveTier: "PR",
    status: "PASS",
    scope: null,
    checks,
    note: "PR verification composes repository integrity, full local verification, build, and migration-tooling tests. Exact-head CI migration smoke remains a separate merge gate.",
  })
}

export function runFocusedVerification({
  files,
  base,
  commandRunner = defaultCommandRunner,
} = {}) {
  let scope
  if (files?.length) {
    scope = { files, unknown: false, detail: "Explicit changed-file scope supplied." }
  } else {
    scope = gitChangedFiles(base, commandRunner)
  }

  let plan
  if (scope.unknown) {
    plan = {
      files: [],
      escalated: true,
      categories: [],
      checks: PR_CHECKS,
      detail: `${scope.detail} Escalating to PR verification.`,
    }
  } else {
    plan = planFocusedVerification(scope.files)
  }

  const scopeStatus = plan.files.length === 0 && !plan.escalated
    ? "SKIPPED"
    : "PASS"
  const checks = [check(
    "changed-file-scope",
    scopeStatus,
    plan.detail,
  )]
  checks.push(...plan.checks.map((definition) => runCheck(
    definition,
    commandRunner,
  )))

  return finishReport({
    schemaVersion: 1,
    requestedTier: "FOCUSED",
    effectiveTier: plan.escalated ? "PR" : "FOCUSED",
    status: "PASS",
    scope: {
      base: base ?? null,
      files: plan.files,
      categories: plan.categories,
    },
    checks,
    note: plan.escalated
      ? "Focused verification did not claim confidence; the command ran the PR tier."
      : "Focused verification covers only the explicit mapped scope and is not full PR confidence.",
  })
}

export function runReleaseVerification({
  args = [],
  commandRunner = defaultCommandRunner,
} = {}) {
  const releaseScript = resolve(scriptDirectory, "release-status.mjs")
  const result = commandRunner(
    process.execPath,
    [releaseScript, "--json", ...args],
    webDirectory,
  )
  let releaseReport = null
  try {
    releaseReport = JSON.parse(result.stdout)
  } catch {
    // The check below records malformed or missing release evidence.
  }

  let releaseCheck
  if (result.exitCode !== 0 || !releaseReport) {
    releaseCheck = check(
      "release-status",
      "FAIL",
      releaseReport?.nextAction
        ?? "Existing release-status verification did not complete successfully.",
      commandLabel(process.execPath, [releaseScript, "--json", ...args]),
    )
  } else {
    const unavailable = releaseReport.warnings?.length > 0
      || releaseReport.checks?.some(
        (item) => ["WARN", "SKIP"].includes(item.status),
      )
    releaseCheck = check(
      "release-status",
      unavailable ? "UNAVAILABLE" : "PASS",
      unavailable
        ? "Release status passed with explicitly unavailable or inconclusive external evidence."
        : "Existing release/status workflow passed with complete required evidence.",
      commandLabel(process.execPath, [releaseScript, "--json", ...args]),
    )
  }

  return finishReport({
    schemaVersion: 1,
    requestedTier: "RELEASE",
    effectiveTier: "RELEASE",
    status: "PASS",
    scope: null,
    checks: [releaseCheck],
    releaseReport,
    note: "Release verification is read-only and delegates commit, deployment, manifest, project, and exact-SHA CI binding to rg:release:status.",
  })
}

export function renderVerificationText(report) {
  const lines = [
    `${report.requestedTier} verification: ${report.status}`,
    `Effective tier: ${report.effectiveTier}`,
    ...report.checks.map(
      (item) => `- ${item.name}: ${item.status} - ${item.detail}`,
    ),
    report.note,
  ]
  for (const item of report.checks) {
    if (item.status === "FAIL" && item.output?.trim()) {
      lines.push(`Failure output (${item.name}):`, item.output.trim())
    }
  }
  return lines.join("\n")
}

export function renderVerificationJson(report) {
  const structured = {
    ...report,
    checks: report.checks.map(({ output: _output, ...item }) => item),
  }
  const output = `${JSON.stringify(structured, null, 2)}\n`
  assertSafeOutput(output)
  return output
}

function parseArgs(argv) {
  const [tier, ...rest] = argv
  if (!["focused", "pr", "release"].includes(tier)) {
    throw new Error(
      "Usage: verification.mjs focused (--base REF | --file PATH...) [--json] | pr [--json] | release [--json] RELEASE_STATUS_ARGS",
    )
  }
  const json = rest.includes("--json")
  const args = rest.filter((argument) => argument !== "--json")
  if (tier !== "focused") return { tier, json, args }

  let base = null
  const files = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--base") {
      if (base || !args[index + 1]) throw new Error("--base requires one ref")
      base = args[index + 1]
      index += 1
    } else if (args[index] === "--file") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("--file requires one repository-relative path")
      }
      files.push(args[index + 1])
      index += 1
    } else {
      throw new Error(`Unexpected focused-verification argument: ${args[index]}`)
    }
  }
  if ((!base && files.length === 0) || (base && files.length > 0)) {
    throw new Error("Focused verification requires exactly one scope: --base or one or more --file values")
  }
  return { tier, json, base, files }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = options.tier === "focused"
    ? runFocusedVerification(options)
    : options.tier === "pr"
      ? runPrVerification()
      : runReleaseVerification({ args: options.args })
  process.stdout.write(
    options.json
      ? renderVerificationJson(report)
      : `${renderVerificationText(report)}\n`,
  )
  if (report.status === "FAIL") process.exitCode = 1
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
