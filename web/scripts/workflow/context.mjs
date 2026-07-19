import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { classifyDatabaseEndpoint, databaseUrlMatchesProject } from "../operational/runtime.mjs"
import {
  ENVIRONMENT_INPUTS,
  RECIPE_GENIE_PACKAGE_NAME,
  RECIPE_GENIE_PROJECT_REF,
  SUPPORTED_NODE_MAJOR,
  SUPPORTED_NPM_MAJOR,
  TOOL_DEFINITIONS,
  WORKFLOW_TIERS,
  WORKTREE_BRANCH_PREFIX,
} from "./policy.mjs"
import { assertSafeOutput } from "./state.mjs"

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/

function defaultCommandRunner(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
  }
}

function runGit(commandRunner, cwd, args) {
  const result = commandRunner("git", args, cwd)
  if (result.exitCode !== 0) throw new Error(`Git ${args[0]} failed`)
  return result.stdout.trim()
}

function normalizePath(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase()
}

function parseWorktreePaths(output) {
  return output.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9))
}

function parseMajor(version) {
  const match = String(version || "").match(/^(?:v)?(\d+)/)
  return match ? Number(match[1]) : null
}

function npmVersionFromEnvironment(environment) {
  const match = String(environment.npm_config_user_agent || "").match(/(?:^|\s)npm\/([^\s]+)/)
  return match ? match[1] : null
}

function executableCandidates(command, environment, repositoryRoot, definition) {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""]
  const candidates = []
  if (definition.localBin) {
    for (const extension of extensions) candidates.push(path.join(repositoryRoot, "web", "node_modules", ".bin", `${command}${extension}`))
  }
  if (process.platform === "win32" && ["psql", "pg_dump"].includes(command)) {
    const programFiles = environment.ProgramFiles || "C:\\Program Files"
    for (let major = 18; major >= 12; major -= 1) candidates.push(path.join(programFiles, "PostgreSQL", String(major), "bin", `${command}.exe`))
  }
  for (const directory of String(environment.PATH || environment.Path || "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) candidates.push(path.join(directory, `${command}${extension}`))
  }
  return candidates
}

function discoverTools({ environment, repositoryRoot, exists }) {
  return Object.fromEntries(TOOL_DEFINITIONS.map((definition) => {
    const executable = definition.commands.flatMap((command) => executableCandidates(command, environment, repositoryRoot, definition)).find(exists)
    return [definition.key, { label: definition.label, available: Boolean(executable) }]
  }))
}

function credentialFileChecks(homeDirectory, exists) {
  const definitions = [
    ["Supabase CLI credential file", path.join(homeDirectory, ".supabase", "access-token")],
    ["GitHub CLI credential file", path.join(homeDirectory, ".config", "gh", "hosts.yml")],
    ["Vercel CLI credential file", path.join(homeDirectory, "AppData", "Roaming", "com.vercel.cli", "Data", "auth.json")],
  ]
  return definitions.map(([name, filePath]) => ({ name, present: exists(filePath) }))
}

function classifyEndpoint(databaseUrl, expectedProjectRef) {
  if (!databaseUrl) return { configured: false, type: null, matchesProject: null }
  try {
    const classified = classifyDatabaseEndpoint(databaseUrl)
    return {
      configured: true,
      type: classified === "unknown-pooler" ? "unknown" : classified,
      matchesProject: databaseUrlMatchesProject(databaseUrl, expectedProjectRef),
    }
  } catch {
    return { configured: true, type: "unknown", matchesProject: false }
  }
}

function capability(possible, reasons, tier) {
  return { possible, tier, reasons: [...new Set(reasons)] }
}

function buildCapabilities({ tools, nodeSupported, npmSupported, repositoryValid, identityValid, endpoint, databaseEndpointsValid, inputs, linkedProject }) {
  const localReasons = []
  if (!repositoryValid) localReasons.push("repository identity is invalid")
  if (!tools.git.available) localReasons.push("Git is unavailable")
  if (!nodeSupported) localReasons.push("Node 22 is required")
  if (!npmSupported) localReasons.push("npm 10 is required")

  const productionIdentityReasons = []
  if (!identityValid) productionIdentityReasons.push("project identity is contradictory")
  if (!databaseEndpointsValid) productionIdentityReasons.push("database endpoint configuration is contradictory")
  if (!endpoint.configured) productionIdentityReasons.push("database URL is absent")
  if (endpoint.configured && !["direct", "session-pooler"].includes(endpoint.type)) productionIdentityReasons.push("database endpoint is unsupported")
  if (endpoint.configured && endpoint.matchesProject !== true) productionIdentityReasons.push("database endpoint does not identify the expected project")

  const explicitProjectPresent = inputs.RECIPE_GENIE_PRODUCTION_PROJECT_REF || inputs.RG_EXPECTED_SUPABASE_PROJECT_REF
  const readOnlyReasons = [...localReasons, ...productionIdentityReasons]
  if (!inputs.RG_PRODUCTION_URL) readOnlyReasons.push("RG_PRODUCTION_URL is absent")
  if (!inputs.RG_EXPECTED_GIT_SHA) readOnlyReasons.push("RG_EXPECTED_GIT_SHA is absent")
  if (!explicitProjectPresent) readOnlyReasons.push("explicit project reference is absent")

  const linkedReasons = [...productionIdentityReasons]
  if (!explicitProjectPresent) linkedReasons.push("explicit project reference is absent")
  if (!linkedProject.present) linkedReasons.push("local Supabase link is absent")
  if (linkedProject.present && linkedProject.matchesExpected !== true) linkedReasons.push("local Supabase link is contradictory")

  const backupReasons = [...linkedReasons]
  if (!inputs.RECIPE_GENIE_SUPABASE_ACCESS_TOKEN && !inputs.SUPABASE_ACCESS_TOKEN) backupReasons.push("Supabase access token is absent")
  if (!tools.pwsh.available) backupReasons.push("PowerShell Core is unavailable")
  if (!tools.pgDump.available) backupReasons.push("pg_dump is unavailable")

  const preflightReasons = [...linkedReasons]
  if (!tools.supabase.available) preflightReasons.push("Supabase CLI is unavailable")

  const migrationReasons = [...backupReasons]
  if (!tools.supabase.available) migrationReasons.push("Supabase CLI is unavailable")

  const inspectionReasons = []
  if (!tools.gh.available && !tools.vercel.available) inspectionReasons.push("GitHub CLI and Vercel CLI are unavailable")
  if (!inputs.GH_TOKEN && !inputs.GITHUB_TOKEN && !inputs.VERCEL_TOKEN) inspectionReasons.push("explicit deployment credential is absent")

  const modificationReasons = [...inspectionReasons]
  if (!tools.git.available) modificationReasons.push("Git is unavailable")

  return {
    "local-verification": capability(localReasons.length === 0, localReasons, 1),
    "read-only-production-verification": capability(readOnlyReasons.length === 0, readOnlyReasons, 1),
    "production-backup": capability(backupReasons.length === 0, backupReasons, 2),
    "migration-preflight": capability(preflightReasons.length === 0, preflightReasons, 2),
    "migration-application": capability(migrationReasons.length === 0, migrationReasons, 2),
    "deployment-inspection": capability(inspectionReasons.length === 0, inspectionReasons, 1),
    "deployment-modification": capability(modificationReasons.length === 0, modificationReasons, 2),
  }
}

export function collectDoctorReport(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const environment = options.environment || process.env
  const exists = options.exists || fs.existsSync
  const readText = options.readText || ((filePath) => fs.readFileSync(filePath, "utf8"))
  const commandRunner = options.commandRunner || defaultCommandRunner
  const homeDirectory = options.homeDirectory || os.homedir()
  const nodeVersion = options.nodeVersion || process.version

  const blockers = []
  const warnings = []
  const actions = []
  const repositoryRoot = runGit(commandRunner, cwd, ["rev-parse", "--show-toplevel"])
  const packagePath = path.join(repositoryRoot, "web", "package.json")
  let packageJson = null
  try {
    packageJson = JSON.parse(readText(packagePath))
  } catch {
    blockers.push("Repository package identity could not be read.")
  }
  const repositoryValid = packageJson?.name === RECIPE_GENIE_PACKAGE_NAME && exists(path.join(repositoryRoot, "supabase", "migrations", "001_baseline.sql"))
  if (!repositoryValid) blockers.push("Checkout does not match the Recipe Genie repository identity.")

  const gitSha = runGit(commandRunner, repositoryRoot, ["rev-parse", "HEAD"])
  const branch = runGit(commandRunner, repositoryRoot, ["branch", "--show-current"]) || "(detached)"
  const dirty = Boolean(runGit(commandRunner, repositoryRoot, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"]))
  const worktreePaths = parseWorktreePaths(runGit(commandRunner, repositoryRoot, ["worktree", "list", "--porcelain"]))
  const primaryRoot = worktreePaths[0] || repositoryRoot
  const isPrimary = normalizePath(primaryRoot) === normalizePath(repositoryRoot)
  const compliantParent = path.join(path.dirname(primaryRoot), ".worktrees", "recipe-genie")
  const pathCompliant = isPrimary || normalizePath(repositoryRoot).startsWith(`${normalizePath(compliantParent)}${path.sep}`)
  const branchCompliant = isPrimary || branch.startsWith(WORKTREE_BRANCH_PREFIX)
  if (!pathCompliant) blockers.push("Worktree path violates the Recipe Genie worktree convention.")
  if (!branchCompliant) blockers.push("Worktree branch violates the codex/ branch convention.")
  if (isPrimary) warnings.push("Doctor is running in the primary checkout; implementation work belongs in an isolated worktree.")

  const nodeMajor = parseMajor(nodeVersion)
  const npmVersion = options.npmVersion ?? npmVersionFromEnvironment(environment)
  const npmMajor = parseMajor(npmVersion)
  const nodeSupported = nodeMajor === SUPPORTED_NODE_MAJOR
  const npmSupported = npmMajor === SUPPORTED_NPM_MAJOR
  if (!nodeSupported) actions.push(`Run rg:doctor with repository-supported Node ${SUPPORTED_NODE_MAJOR}.`)
  if (!npmSupported) actions.push(`Run rg:doctor through repository-supported npm ${SUPPORTED_NPM_MAJOR}.`)

  const tools = discoverTools({ environment, repositoryRoot, exists })
  const missingTools = Object.values(tools).filter((tool) => !tool.available).map((tool) => tool.label)
  if (missingTools.length) warnings.push(`Optional tools unavailable: ${missingTools.join(", ")}.`)

  const inputPresence = Object.fromEntries(ENVIRONMENT_INPUTS.map((input) => [input.name, Boolean(String(environment[input.name] || "").trim())]))
  const explicitRefs = [environment.RG_EXPECTED_SUPABASE_PROJECT_REF, environment.RECIPE_GENIE_PRODUCTION_PROJECT_REF].filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
  let identityValid = true
  if (explicitRefs.some((reference) => !PROJECT_REF_PATTERN.test(reference) || reference !== RECIPE_GENIE_PROJECT_REF) || new Set(explicitRefs).size > 1) {
    identityValid = false
    blockers.push("Explicit Supabase project identity contradicts the approved Recipe Genie project.")
  }

  const linkedPath = path.join(repositoryRoot, "supabase", ".temp", "project-ref")
  let linkedReference = null
  if (exists(linkedPath)) {
    try { linkedReference = readText(linkedPath).trim() } catch { linkedReference = "" }
  }
  const linkedProject = {
    present: linkedReference !== null,
    valid: linkedReference === null ? null : PROJECT_REF_PATTERN.test(linkedReference),
    matchesExpected: linkedReference === null ? null : linkedReference === RECIPE_GENIE_PROJECT_REF,
  }
  if (!linkedProject.present) warnings.push("Local Supabase link is absent; explicit non-contradictory identity remains usable.")
  if (linkedProject.present && (!linkedProject.valid || !linkedProject.matchesExpected)) {
    identityValid = false
    blockers.push("Local Supabase link contradicts the approved Recipe Genie project.")
  }

  const databaseUrls = [environment.RECIPE_GENIE_PRODUCTION_DATABASE_URL, environment.RG_DATABASE_URL]
    .filter((value) => typeof value === "string" && value.trim())
  const endpointChecks = databaseUrls.map((databaseUrl) => classifyEndpoint(databaseUrl, RECIPE_GENIE_PROJECT_REF))
  const endpoint = endpointChecks[0] || classifyEndpoint(null, RECIPE_GENIE_PROJECT_REF)
  const databaseEndpointsValid = endpointChecks.every((candidate) => candidate.type !== "unknown" && candidate.matchesProject === true && candidate.type !== "transaction-pooler")
  if (endpointChecks.some((candidate) => candidate.type === "unknown" || candidate.matchesProject !== true)) {
    blockers.push("Explicit database endpoint cannot be matched to the approved Recipe Genie project.")
  }
  if (endpointChecks.some((candidate) => candidate.type === "transaction-pooler")) blockers.push("Transaction-pooler database endpoints are prohibited for these workflows.")

  const credentialFiles = credentialFileChecks(homeDirectory, exists)
  const capabilities = buildCapabilities({ tools, nodeSupported, npmSupported, repositoryValid, identityValid, endpoint, databaseEndpointsValid, inputs: inputPresence, linkedProject })
  for (const [name, details] of Object.entries(capabilities)) {
    if (!details.possible) warnings.push(`${name} unavailable: ${details.reasons.join("; ")}.`)
  }
  if (!capabilities["local-verification"].possible && !actions.length) actions.push("Install or select the required local verification runtime and tools.")

  const uniqueBlockers = [...new Set(blockers)]
  const uniqueWarnings = [...new Set(warnings)]
  const uniqueActions = [...new Set(actions)]
  const status = uniqueBlockers.length ? "BLOCKED" : uniqueActions.length ? "ACTION REQUIRED" : "COMPLETE"
  const nextRecommendedAction = uniqueBlockers[0]
    ? `Resolve blocker: ${uniqueBlockers[0]}`
    : uniqueActions[0] || (capabilities["local-verification"].possible ? "Run npm run verify for Tier 1 validation." : "Review unavailable capabilities.")

  return {
    status,
    repository: { root: repositoryRoot, identity: repositoryValid ? RECIPE_GENIE_PACKAGE_NAME : "invalid" },
    git: { sha: gitSha, branch, dirty, worktree: isPrimary ? "primary" : "linked", pathCompliant, branchCompliant },
    runtime: { node: nodeVersion, nodeSupported, npm: npmVersion || "unknown", npmSupported },
    tools,
    inputs: ENVIRONMENT_INPUTS.map((input) => ({ name: input.name, purpose: input.purpose, present: inputPresence[input.name], secret: input.secret })),
    credentialFiles,
    project: { expected: RECIPE_GENIE_PROJECT_REF, explicitPresent: explicitRefs.length > 0, identityValid, linked: linkedProject },
    database: endpoint,
    tiers: WORKFLOW_TIERS,
    capabilities,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    actions: uniqueActions,
    nextRecommendedAction,
  }
}

function yesNo(value) {
  return value ? "YES" : "NO"
}

export function renderDoctorReport(report) {
  const lines = [
    "Recipe Genie workflow doctor (read-only; no network calls)",
    `Repository: ${report.repository.root}`,
    `Identity: ${report.repository.identity}`,
    `Git: ${report.git.sha} | ${report.git.branch} | dirty=${yesNo(report.git.dirty)} | ${report.git.worktree}`,
    `Worktree conventions: path=${yesNo(report.git.pathCompliant)} branch=${yesNo(report.git.branchCompliant)}`,
    `Runtime: Node ${report.runtime.node} (${report.runtime.nodeSupported ? "supported" : "unsupported"}); npm ${report.runtime.npm} (${report.runtime.npmSupported ? "supported" : "unsupported"})`,
    "Tools:",
    ...Object.values(report.tools).map((tool) => `- ${tool.label}: ${tool.available ? "AVAILABLE" : "MISSING"}`),
    "Inputs (presence only):",
    ...report.inputs.map((input) => `- ${input.name}: ${input.present ? "PRESENT" : "ABSENT"}${input.secret ? " (value hidden)" : ""}`),
    ...report.credentialFiles.map((input) => `- ${input.name}: ${input.present ? "PRESENT" : "ABSENT"} (contents not read)`),
    `Expected Supabase project: ${report.project.expected}`,
    `Local Supabase link: ${report.project.linked.present ? (report.project.linked.matchesExpected ? "MATCH" : "MISMATCH") : "ABSENT"}`,
    `Database endpoint: ${report.database.configured ? report.database.type : "NOT CONFIGURED"}`,
    "Workflow tiers:",
    ...Object.entries(report.tiers).map(([tier, description]) => `- Tier ${tier}: ${description}`),
    "Capabilities:",
    ...Object.entries(report.capabilities).map(([name, details]) => `- ${name} (Tier ${details.tier}): ${details.possible ? "POSSIBLE" : "UNAVAILABLE"}`),
    "",
    `STATUS: ${report.status}`,
    "Blockers:",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
    "Warnings:",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "Manual action:",
    ...(report.actions.length ? report.actions.map((item) => `- ${item}`) : ["- None"]),
    "Next recommended action:",
    `- ${report.nextRecommendedAction}`,
  ]
  const output = lines.join("\n")
  const configuredSecrets = report.inputs.filter((input) => input.secret && input.present).map((input) => process.env[input.name])
  return assertSafeOutput(output, configuredSecrets)
}

export function renderDoctorJson(report) {
  const output = `${JSON.stringify(report, null, 2)}\n`
  const configuredSecrets = report.inputs.filter((input) => input.secret && input.present).map((input) => process.env[input.name])
  return assertSafeOutput(output, configuredSecrets)
}
