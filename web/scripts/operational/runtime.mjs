const READ_ONLY_PREFIX = /^(select|with|show)\b/i
const WRITE_KEYWORD = /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|refresh|reindex|cluster)\b/i
const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i

export function isFullGitSha(value) {
  return FULL_GIT_SHA_PATTERN.test(value || "")
}

export function validateProductionTarget({ appUrl, expectedSha }) {
  if (!isFullGitSha(expectedSha)) {
    throw new Error("expected Git SHA must contain 40 hexadecimal characters")
  }

  let parsed
  try {
    parsed = new URL(appUrl)
  } catch {
    throw new Error("production application URL must be an HTTPS origin")
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("production application URL must be an HTTPS origin without credentials, path, query, or fragment")
  }

  return {
    appUrl: parsed.origin,
    expectedSha: expectedSha.toLowerCase(),
  }
}

export function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`)
    const separator = argument.indexOf("=")
    if (separator !== -1) {
      values[argument.slice(2, separator)] = argument.slice(separator + 1)
      continue
    }
    const key = argument.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      values[key] = true
    } else {
      values[key] = next
      index += 1
    }
  }
  return values
}

export function option(args, name, envName, { required = false } = {}) {
  const value = args[name] || process.env[envName]
  if (required && (typeof value !== "string" || !value.trim())) {
    throw new Error(`missing --${name} (or ${envName})`)
  }
  return typeof value === "string" ? value.trim() : undefined
}

export function assertReadOnlySql(query) {
  const normalized = query.replace(/--.*$/gm, "").trim()
  const withoutStringLiterals = normalized.replace(/'(?:''|[^'])*'/g, "''")
  if (!READ_ONLY_PREFIX.test(normalized) || /;\s*\S/.test(normalized) || WRITE_KEYWORD.test(withoutStringLiterals)) {
    throw new Error("operational queries must contain one SELECT, WITH, or SHOW statement")
  }
}

export function classifyDatabaseEndpoint(databaseUrl) {
  const parsed = new URL(databaseUrl)
  if (!parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com")) return "direct"
  if (parsed.port === "6543") return "transaction-pooler"
  if (parsed.port === "5432") return "session-pooler"
  return "unknown-pooler"
}

export function assertDatabaseEndpointPolicy(databaseUrl, { allowSessionPooler = false } = {}) {
  const endpoint = classifyDatabaseEndpoint(databaseUrl)
  if (endpoint === "transaction-pooler") {
    throw new Error("Supabase transaction pooler endpoints are prohibited for operational verification")
  }
  if (endpoint === "unknown-pooler") {
    throw new Error("Supabase pooler endpoint must declare port 5432 or 6543")
  }
  if (endpoint === "session-pooler" && !allowSessionPooler) {
    throw new Error("Supabase session pooler requires explicit --allow-session-pooler authorization")
  }
  return endpoint
}

export async function withReadOnlyDatabase(databaseUrl, callback, options = {}) {
  assertDatabaseEndpointPolicy(databaseUrl, options)
  const { default: postgres } = await import("postgres")
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })

  try {
    await sql.unsafe("set session characteristics as transaction read only")
    await sql.unsafe("begin transaction read only")
    await sql.unsafe("set local statement_timeout = '15s'")
    const query = async (statement, parameters = []) => {
      assertReadOnlySql(statement)
      return sql.unsafe(statement, parameters)
    }
    return await callback(query)
  } finally {
    try {
      await sql.unsafe("rollback")
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
}

export async function runChecks(definitions, context) {
  const results = []
  for (const definition of definitions) {
    if (definition.skip) {
      results.push({ name: definition.name, status: "SKIP", detail: definition.skip })
      continue
    }
    try {
      const detail = await definition.run(context)
      results.push({ name: definition.name, status: "PASS", detail: detail || "ok" })
    } catch (error) {
      results.push({
        name: definition.name,
        status: "FAIL",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

export function printCheckResults(results, output = console.log) {
  for (const result of results) output(`${result.status.padEnd(4)} ${result.name} - ${result.detail}`)
  const summary = results.reduce((counts, result) => {
    counts[result.status] += 1
    return counts
  }, { PASS: 0, FAIL: 0, SKIP: 0 })
  output(`Summary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.SKIP} SKIP`)
  return summary
}

export function parsePublicManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("response is not a manifest object")
  }
  const required = [
    "applicationVersion",
    "expectedLatestMigration",
    "expectedSupabaseProjectRef",
  ]
  for (const field of required) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`manifest ${field} is missing`)
  }
  if (value.gitSha !== null && !isFullGitSha(value.gitSha)) {
    throw new Error("manifest Git SHA is invalid")
  }
  if (value.buildTimestamp !== null && Number.isNaN(Date.parse(value.buildTimestamp))) {
    throw new Error("manifest build timestamp is invalid")
  }
  if (!/^\d{3}_[a-z0-9_]+$/.test(value.expectedLatestMigration)) {
    throw new Error("manifest expected migration is invalid")
  }
  if (!/^[a-z]{20}$/.test(value.expectedSupabaseProjectRef)) {
    throw new Error("manifest project reference is invalid")
  }
  return value
}

export function databaseUrlMatchesProject(databaseUrl, expectedProjectRef) {
  const parsed = new URL(databaseUrl)
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === `db.${expectedProjectRef}.supabase.co`) return decodeURIComponent(parsed.username) === "postgres"
  if (hostname !== "pooler.supabase.com" && !hostname.endsWith(".pooler.supabase.com")) return false
  return decodeURIComponent(parsed.username) === `postgres.${expectedProjectRef}`
}
