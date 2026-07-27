import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  LOCAL_APP_ORIGIN,
  assertLocalCredentialSource,
  assertLocalRuntimeConfig,
  createLocalRuntime,
  findLocalCredentials,
  localSupabaseEnvironment,
  parseEnv,
} from './local-e2e-runtime.mjs'
import {
  VERIFICATION_STATUS,
  assertSafeInheritedLocalConfig,
  buildLocalE2EConfig,
  redactSecrets,
  runChildCommand,
} from './recipe-import-verification-runtime.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '..')
const configPath = path.join(webRoot, '.env.e2e.local')
let knownSecrets = []

function git(args) {
  return execFileSync('git', args, {
    cwd: webRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
}

function normalized(value) {
  return path.resolve(value).replaceAll('\\', '/').toLowerCase()
}

function confirmRepositoryIdentity() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'))
  if (packageJson.name !== 'recipe-genie') {
    throw new Error('Repository identity check failed: package is not Recipe Genie')
  }

  const gitRoot = git(['rev-parse', '--show-toplevel'])
  if (normalized(gitRoot) !== normalized(repositoryRoot)) {
    throw new Error('Repository identity check failed: Git root and package root disagree')
  }

  const registeredWorktrees = git(['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => normalized(line.slice('worktree '.length)))
  if (!registeredWorktrees.includes(normalized(repositoryRoot))) {
    throw new Error('Repository identity check failed: checkout is not a registered Git worktree')
  }

  const ignored = git(['check-ignore', '.env.e2e.local'])
  if (!ignored) {
    throw new Error('Worktree E2E configuration is not ignored; refusing to generate it')
  }

  return {
    branch: git(['branch', '--show-current']) || '(detached)',
    linked: registeredWorktrees[0] !== normalized(repositoryRoot),
  }
}

async function verifyLocalAuthentication(values) {
  const client = createClient(values.supabaseUrl, values.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: values.email,
    password: values.password,
  })
  if (error || !data.user) return false
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
  return true
}

function writeWorktreeConfig(values) {
  fs.writeFileSync(configPath, buildLocalE2EConfig({
    appOrigin: LOCAL_APP_ORIGIN,
    ...values,
  }), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function printFailure(status, message, nextAction) {
  console.error(`\nSTATUS: ${status}`)
  console.error(`Failure: ${redactSecrets(message, knownSecrets)}`)
  console.error(`Next action: ${nextAction}`)
}

async function main() {
  console.log('Recipe Genie recipe import browser verification')

  let identity
  try {
    identity = confirmRepositoryIdentity()
  } catch (error) {
    printFailure(
      VERIFICATION_STATUS.blocked,
      error instanceof Error ? error.message : 'repository identity validation failed',
      'Run the command from a registered Recipe Genie checkout.'
    )
    process.exitCode = 1
    return
  }
  console.log(
    `Environment target validation: PASS (branch=${identity.branch}, worktree=${identity.linked ? 'linked' : 'primary'}, loopback-only)`
  )

  let runtime
  try {
    runtime = createLocalRuntime(webRoot)
  } catch (error) {
    printFailure(
      VERIFICATION_STATUS.actionRequired,
      error instanceof Error ? error.message : 'local runtime validation failed',
      'Start Docker Desktop and rerun npm run verify:recipe-import with Node 22.'
    )
    process.exitCode = 2
    return
  }

  let status = runtime.status()
  let readinessDecision = 'reused running local Supabase'
  if (!status.ok) {
    console.log(
      'Local Supabase readiness: starting or initializing loopback-only services without reset; a new local volume may apply tracked migrations...'
    )
    const started = runtime.start()
    if (!started.ok) {
      printFailure(
        VERIFICATION_STATUS.actionRequired,
        'local Supabase could not be started',
        'Start Docker Desktop, run npm run local:e2e:status, then rerun npm run verify:recipe-import.'
      )
      process.exitCode = 2
      return
    }
    status = runtime.status()
    readinessDecision = 'started stopped local Supabase'
  }
  if (!status.ok) {
    printFailure(
      VERIFICATION_STATUS.actionRequired,
      'local Supabase did not become ready',
      'Run npm run local:e2e:status, resolve the reported local service issue, then rerun npm run verify:recipe-import.'
    )
    process.exitCode = 2
    return
  }

  let local
  try {
    local = localSupabaseEnvironment(status.output)
  } catch (error) {
    printFailure(
      VERIFICATION_STATUS.blocked,
      error instanceof Error ? error.message : 'local Supabase target validation failed',
      'Correct the local Supabase target before rerunning the verifier.'
    )
    process.exitCode = 1
    return
  }
  console.log(`Local Supabase readiness: PASS (${readinessDecision})`)

  const configPresent = fs.existsSync(configPath)
  let credentials
  let existingValues = null
  try {
    if (configPresent) {
      existingValues = parseEnv(fs.readFileSync(configPath, 'utf8'))
      credentials = assertLocalCredentialSource(existingValues)
    } else {
      credentials = findLocalCredentials(webRoot)
    }
  } catch (error) {
    printFailure(
      VERIFICATION_STATUS.blocked,
      error instanceof Error ? error.message : 'safe local credential discovery failed',
      'Create the ignored loopback-only web/.env.e2e.local described in tests/E2E_CREDENTIALS.md.'
    )
    process.exitCode = 1
    return
  }

  knownSecrets = [
    credentials.email,
    credentials.password,
    local.anonKey,
    local.serviceRoleKey,
  ]
  const expectedConfig = {
    ...credentials,
    appOrigin: LOCAL_APP_ORIGIN,
    supabaseUrl: local.supabaseUrl,
    anonKey: local.anonKey,
  }

  try {
    assertSafeInheritedLocalConfig(process.env, expectedConfig)
  } catch (error) {
    printFailure(
      VERIFICATION_STATUS.blocked,
      error instanceof Error ? error.message : 'inherited environment validation failed',
      'Unset the conflicting inherited E2E or Supabase variables, then rerun the verifier.'
    )
    process.exitCode = 1
    return
  }

  let configMatchesRuntime = false
  if (existingValues) {
    try {
      const parsed = assertLocalRuntimeConfig(existingValues)
      configMatchesRuntime =
        parsed.supabaseUrl === local.supabaseUrl &&
        parsed.anonKey === local.anonKey
    } catch {
      configMatchesRuntime = false
    }
  }

  if (!configPresent || !configMatchesRuntime) {
    writeWorktreeConfig(expectedConfig)
    console.log(
      `Bootstrap decision: generated ignored worktree E2E configuration (${configPresent ? 'refreshed stale local runtime values' : 'configuration was missing'})`
    )
  } else {
    console.log('Bootstrap decision: reused existing safe worktree E2E configuration')
  }

  const runtimeValues = assertLocalRuntimeConfig(
    parseEnv(fs.readFileSync(configPath, 'utf8')),
    process.env
  )
  const authenticationReady = await verifyLocalAuthentication(runtimeValues)
  if (!authenticationReady) {
    printFailure(
      VERIFICATION_STATUS.actionRequired,
      'the dedicated local E2E user is missing or cannot sign in; no reset was performed',
      'Authorize and run npm run local:e2e:bootstrap to reset loopback-local fixtures, then rerun npm run verify:recipe-import.'
    )
    process.exitCode = 2
    return
  }
  console.log('Fixture decision: reused local authentication; browser tests create and clean disposable recipe data')

  const playwrightCli = path.join(
    webRoot,
    'node_modules',
    '@playwright',
    'test',
    'cli.js'
  )
  const childEnvironment = {
    ...process.env,
    RECIPE_GENIE_E2E_TARGET: 'local',
    RECIPE_GENIE_E2E_LOCAL_ONLY: 'true',
    RECIPE_GENIE_E2E_BASE_URL: LOCAL_APP_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: runtimeValues.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: runtimeValues.anonKey,
    RECIPE_GENIE_E2E_EMAIL: runtimeValues.email,
    RECIPE_GENIE_E2E_PASSWORD: runtimeValues.password,
  }
  delete childEnvironment.SUPABASE_SERVICE_ROLE_KEY
  delete childEnvironment.RECIPE_GENIE_E2E_ALLOW_PRODUCTION
  delete childEnvironment.NO_COLOR

  const browser = runChildCommand({
    command: process.execPath,
    args: [playwrightCli, 'test', '--project=recipe-import'],
    cwd: webRoot,
    env: childEnvironment,
    secrets: knownSecrets,
  })
  if (browser.output) console.log(`\n${browser.output}`)

  if (!browser.ok) {
    printFailure(
      VERIFICATION_STATUS.actionRequired,
      `browser scenarios failed with exit code ${browser.status}`,
      'Inspect the ignored Playwright report/test-results artifacts, fix the failure, and rerun npm run verify:recipe-import.'
    )
    process.exitCode = browser.status || 1
    return
  }

  console.log('\nSTATUS: COMPLETE')
  console.log('Environment target validation: PASS')
  console.log('Browser scenarios: PASS (Markdown create/replace and legacy import)')
  console.log('Cleanup: PASS (disposable recipe rows removed)')
}

main().catch((error) => {
  printFailure(
    VERIFICATION_STATUS.actionRequired,
    error instanceof Error ? error.message : 'unexpected verifier failure',
    'Resolve the reported local-only failure and rerun npm run verify:recipe-import.'
  )
  process.exitCode = 1
})
