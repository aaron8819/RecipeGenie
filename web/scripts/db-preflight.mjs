import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  MigrationPreflightError,
  analyzeMigrationState,
  loadMigrationDirectory,
  parseExpectedPendingOption,
  parseMigrationList,
} from "./db-preflight-core.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..")
const repositoryRoot = resolve(webDirectory, "..")
const supabaseDirectory = join(repositoryRoot, "supabase")
const supabaseScript = join(
  webDirectory,
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
)

function printOutput(result) {
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""

  if (stdout.trim()) {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`)
  }
  if (stderr.trim()) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`)
  }
}

function runSupabase(args, { print = false } = {}) {
  const result = spawnSync(process.execPath, [supabaseScript, ...args], {
    cwd: webDirectory,
    encoding: "utf8",
    shell: false,
    stdio: "pipe",
  })

  if (print) printOutput(result)
  if (result.error) {
    throw new Error(`Failed to launch the pinned Supabase CLI: ${result.error.message}`)
  }
  if (result.status !== 0) {
    if (!print) printOutput(result)
    throw new Error(
      "Supabase migration preflight failed before drift analysis completed. "
      + "Confirm the correct project is linked and that the Supabase CLI can reach the target database.",
    )
  }
  return result.stdout ?? ""
}

export async function runMigrationPreflight({
  argv = [],
  checksumRegistryPath = join(
    supabaseDirectory,
    "migration-checksums.json",
  ),
  migrationDirectory = join(supabaseDirectory, "migrations"),
  migrationListRunner = () => runSupabase([
    "--workdir",
    repositoryRoot,
    "migration",
    "list",
    "--linked",
  ], { print: true }),
}) {
  const options = parseExpectedPendingOption(argv)
  if (options.help) return { status: "help" }

  const checksumRegistry = JSON.parse(await readFile(
    checksumRegistryPath,
    "utf8",
  ))
  const localMigrations = await loadMigrationDirectory(
    migrationDirectory,
    checksumRegistry,
  )
  const listRows = parseMigrationList(await migrationListRunner())

  return analyzeMigrationState({
    localMigrations,
    migrationRows: listRows,
    expectedPending: options.expectedPending,
  })
}

export async function main({
  argv = process.argv.slice(2),
  log = (message) => console.log(message),
  ...preflightOptions
} = {}) {
  const result = await runMigrationPreflight({
    argv,
    ...preflightOptions,
  })
  if (result.status === "help") {
    log("Usage: npm run db:preflight -- [--expected-pending VERSION]")
    log("Example rollout opt-in: npm run db:preflight -- --expected-pending 014")
    return
  }

  if (result.status === "expected-pending") {
    log(
      `Migration histories match through ${result.latestRemote}; `
      + `local migration ${result.expectedPending} is the sole explicitly expected pending tail migration.`,
    )
    log("Migration preflight status: EXPECTED PENDING.")
  } else {
    log(
      "Migration version ledgers are aligned; active local migration files "
      + "match the repository checksum registry.",
    )
    log("Migration preflight status: ALIGNED.")
  }
  log(
    "`db:preflight` compares row-aligned local and remote migration versions only. "
    + "`migration-checksums.json` guards local migration files only; this command "
    + "does not verify remote migration names, SQL statements, checksums, or exact "
    + "remote file equivalence.",
  )
  log(
    "Next steps: verify you linked the intended environment, then run "
    + "`npx supabase --workdir .. db push` only under separate migration authorization.",
  )
}

function handleError(error) {
  if (error instanceof MigrationPreflightError) {
    const prefix = error.category === "invalid-configuration"
      ? "Invalid expected-pending configuration"
      : "Migration history drift detected"
    console.error(`${prefix}: ${error.message}`)
    if (error.category === "drift") {
      console.error("Do not run `supabase db push`; investigate the migration histories.")
      console.error(
        "If this is the known baseline-squash case, follow the runbook in "
        + "`supabase/SCHEMA.md` before repairing history.",
      )
    }
    process.exitCode = error.category === "invalid-configuration" ? 2 : 1
    return
  }

  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(handleError)
}
