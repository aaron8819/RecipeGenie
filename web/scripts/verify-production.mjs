#!/usr/bin/env node
import { option, parseArgs, printCheckResults, runChecks, withReadOnlyDatabase } from "./operational/runtime.mjs"
import { createApplicationChecks, createDatabaseChecks } from "./operational/production-checks.mjs"

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: npm run verify:production -- --app-url URL --expected-sha SHA --expected-project-ref REF --database-url URL")
    return
  }

  const appUrl = option(args, "app-url", "RG_PRODUCTION_URL", { required: true })
  const expectedSha = option(args, "expected-sha", "RG_EXPECTED_GIT_SHA", { required: true })
  const expectedProjectRef = option(args, "expected-project-ref", "RG_EXPECTED_SUPABASE_PROJECT_REF", { required: true })
  const databaseUrl = option(args, "database-url", "RG_DATABASE_URL", { required: true })
  const allowSessionPooler = args["allow-session-pooler"] === true
  if (!/^https:\/\//i.test(appUrl)) throw new Error("production application URL must use HTTPS")
  if (!/^[0-9a-f]{7,64}$/i.test(expectedSha)) throw new Error("expected Git SHA is invalid")
  if (!/^[a-z]{20}$/.test(expectedProjectRef)) throw new Error("expected Supabase project reference is invalid")

  const application = createApplicationChecks({ appUrl, expectedSha, expectedProjectRef, databaseUrl })
  const appResults = await runChecks(application.checks, {})
  const manifest = application.getManifest()
  const expectedMigration = manifest?.expectedLatestMigration || "unknown"
  let databaseResults
  if (expectedMigration === "unknown") {
    databaseResults = createDatabaseChecks("000_unknown").map((check) => ({
      name: check.name,
      status: "SKIP",
      detail: "valid deployment manifest unavailable",
    }))
  } else {
    const definitions = createDatabaseChecks(expectedMigration)
    try {
      databaseResults = await withReadOnlyDatabase(databaseUrl, async (query) => (
        runChecks(definitions, { query })
      ), { allowSessionPooler })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      databaseResults = definitions.map((check, index) => ({
        name: check.name,
        status: index === 0 ? "FAIL" : "SKIP",
        detail: index === 0 ? `database connection failed: ${detail}` : "database connection unavailable",
      }))
    }
  }

  const summary = printCheckResults([...appResults, ...databaseResults])
  if (summary.FAIL) process.exitCode = 1
}

main().catch((error) => {
  console.error(`Configuration error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
})
