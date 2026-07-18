#!/usr/bin/env node
import { executeAuditChecks, printAuditResults } from "./operational/audit-checks.mjs"
import { option, parseArgs, withReadOnlyDatabase } from "./operational/runtime.mjs"

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: npm run audit:data -- --database-url URL [--json] [--sample-limit 10]")
    return
  }
  const databaseUrl = option(args, "database-url", "RG_DATABASE_URL", { required: true })
  const allowSessionPooler = args["allow-session-pooler"] === true
  const sampleLimit = Number(args["sample-limit"] || process.env.RG_AUDIT_SAMPLE_LIMIT || 10)
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 50) {
    throw new Error("sample limit must be an integer from 1 through 50")
  }

  const results = await withReadOnlyDatabase(
    databaseUrl,
    (query) => executeAuditChecks(query, sampleLimit),
    { allowSessionPooler },
  )
  if (args.json) console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, results }, null, 2))
  else printAuditResults(results)

  if (results.some((result) => result.status === "FINDING" && result.severity === "ERROR")) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
})
