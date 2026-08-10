export const EXPECTED_LATEST_MIGRATION = "021_fix_shopping_v3_family_policy_validation"
export const EXPECTED_SUPABASE_PROJECT_REF = "eyaoahwzixqetjgfghsh"

export interface DeploymentManifest {
  gitSha: string | null
  buildTimestamp: string | null
  applicationVersion: string
  expectedLatestMigration: string
  expectedSupabaseProjectRef: string
}

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const MIGRATION_PATTERN = /^\d{3}_[a-z0-9_]+$/
const PROJECT_REF_PATTERN = /^[a-z]{20}$/

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("deployment manifest must be an object")
  }

  const candidate = value as Record<string, unknown>
  const gitSha = optionalString(candidate.gitSha)
  const buildTimestamp = optionalString(candidate.buildTimestamp)
  const applicationVersion = optionalString(candidate.applicationVersion)
  const expectedLatestMigration = optionalString(candidate.expectedLatestMigration)
  const expectedSupabaseProjectRef = optionalString(candidate.expectedSupabaseProjectRef)

  if (gitSha && !SHA_PATTERN.test(gitSha)) {
    throw new Error("deployment manifest Git SHA is invalid")
  }
  if (buildTimestamp && Number.isNaN(Date.parse(buildTimestamp))) {
    throw new Error("deployment manifest build timestamp is invalid")
  }
  if (!applicationVersion || !VERSION_PATTERN.test(applicationVersion)) {
    throw new Error("deployment manifest application version is invalid")
  }
  if (!expectedLatestMigration || !MIGRATION_PATTERN.test(expectedLatestMigration)) {
    throw new Error("deployment manifest expected migration is invalid")
  }
  if (!expectedSupabaseProjectRef || !PROJECT_REF_PATTERN.test(expectedSupabaseProjectRef)) {
    throw new Error("deployment manifest Supabase project reference is invalid")
  }

  return {
    gitSha,
    buildTimestamp,
    applicationVersion,
    expectedLatestMigration,
    expectedSupabaseProjectRef,
  }
}

export function getDeploymentManifest(): DeploymentManifest {
  return parseDeploymentManifest({
    gitSha: process.env.RECIPE_GENIE_GIT_SHA,
    buildTimestamp: process.env.RECIPE_GENIE_BUILD_TIMESTAMP,
    applicationVersion: process.env.RECIPE_GENIE_APP_VERSION || "0.0.0",
    expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
    expectedSupabaseProjectRef: EXPECTED_SUPABASE_PROJECT_REF,
  })
}
