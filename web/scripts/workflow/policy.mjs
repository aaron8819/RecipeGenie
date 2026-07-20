export const RECIPE_GENIE_PROJECT_REF = "eyaoahwzixqetjgfghsh"
export const RECIPE_GENIE_PACKAGE_NAME = "recipe-genie"
export const SUPPORTED_NODE_MAJOR = 22
export const SUPPORTED_NPM_MAJOR = 10

export const WORKTREE_PARENT_SEGMENTS = [".worktrees", "recipe-genie"]
export const WORKTREE_BRANCH_PREFIX = "codex/"

export const WORKFLOW_TIERS = Object.freeze({
  1: "Local application and code changes with no production or database writes.",
  2: "Additive, reversible, or forward-repairable production/database changes.",
  3: "Destructive, lossy, ownership-changing, mass-rewrite, compatibility-breaking, or recovery-dependent changes.",
})

export const ENVIRONMENT_INPUTS = Object.freeze([
  { name: "RG_PRODUCTION_URL", purpose: "production application URL", secret: false },
  { name: "RG_EXPECTED_GIT_SHA", purpose: "expected deployed Git SHA", secret: false },
  { name: "RG_EXPECTED_SUPABASE_PROJECT_REF", purpose: "read-only verification project identity", secret: false },
  { name: "RG_DATABASE_URL", purpose: "read-only verification database endpoint", secret: true },
  { name: "RECIPE_GENIE_PRODUCTION_PROJECT_REF", purpose: "production workflow project identity", secret: false },
  { name: "RECIPE_GENIE_PRODUCTION_DATABASE_URL", purpose: "production database endpoint", secret: true },
  { name: "RECIPE_GENIE_SUPABASE_ACCESS_TOKEN", purpose: "Supabase management access", secret: true },
  { name: "SUPABASE_ACCESS_TOKEN", purpose: "Supabase CLI access", secret: true },
  { name: "GH_TOKEN", purpose: "GitHub CLI access", secret: true },
  { name: "GITHUB_TOKEN", purpose: "GitHub CLI access", secret: true },
  { name: "VERCEL_TOKEN", purpose: "Vercel CLI access", secret: true },
])

export const TOOL_DEFINITIONS = Object.freeze([
  { key: "git", label: "Git", commands: ["git"] },
  { key: "pwsh", label: "PowerShell Core", commands: ["pwsh"] },
  { key: "docker", label: "Docker", commands: ["docker"] },
  { key: "supabase", label: "Supabase CLI", commands: ["supabase"], localBin: true },
  { key: "psql", label: "PostgreSQL psql", commands: ["psql"] },
  { key: "pgDump", label: "PostgreSQL pg_dump", commands: ["pg_dump"] },
  { key: "gh", label: "GitHub CLI", commands: ["gh"] },
  { key: "vercel", label: "Vercel CLI", commands: ["vercel"], localBin: true },
])

export function tierForOperation(operation) {
  const tiers = {
    "local-verification": 1,
    "read-only-production-verification": 1,
    "production-backup": 2,
    "migration-preflight": 2,
    "migration-application": 2,
    "deployment-inspection": 1,
    "deployment-modification": 2,
  }
  return tiers[operation]
}

export function resolveWorkflowTier({ selectedTier, recommendedTier }) {
  if (![1, 2, 3].includes(selectedTier) || ![1, 2, 3].includes(recommendedTier)) {
    throw new Error("workflow tier must be 1, 2, or 3")
  }
  return Math.max(selectedTier, recommendedTier)
}
