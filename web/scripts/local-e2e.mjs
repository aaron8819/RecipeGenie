import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOCAL_SUPABASE_ORIGIN,
  createLocalRuntime,
  findLocalCredentials,
  localSupabaseEnvironment,
} from './local-e2e-runtime.mjs'

const command = process.argv[2] || 'bootstrap'
if (!['bootstrap', 'reset', 'status'].includes(command)) {
  console.error('Usage: node scripts/local-e2e.mjs <bootstrap|reset|status>')
  process.exit(2)
}

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`Local E2E ${command} failed: ${message}`)
  process.exit(1)
}

try {
  const runtime = createLocalRuntime(webRoot)
  let status = runtime.status()
  if (command === 'status') {
    if (!status.ok) fail('local Supabase is not running')
    localSupabaseEnvironment(status.output)
    console.log(`Local E2E target is ready at ${LOCAL_SUPABASE_ORIGIN}.`)
    process.exit(0)
  }

  const credentials = findLocalCredentials(webRoot)
  console.log(`Local E2E target: ${LOCAL_SUPABASE_ORIGIN} (Docker project Recipe_Genie).`)

  if (!status.ok) {
    console.log('Starting local Supabase...')
    const started = runtime.start()
    if (!started.ok) fail('Supabase start failed; inspect Docker Desktop and retry')
    status = runtime.status()
  }
  if (!status.ok) fail('local Supabase did not become ready')

  console.log('Resetting the local database and applying repository migrations...')
  const reset = runtime.reset()
  if (!reset.ok) fail('local database reset failed')

  status = runtime.status()
  if (!status.ok) fail('local Supabase did not recover after reset')
  const local = localSupabaseEnvironment(status.output)

  const bootstrap = spawnSync(process.execPath, ['scripts/bootstrap-local-e2e.mjs'], {
    cwd: webRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: local.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
      RECIPE_GENIE_E2E_EMAIL: credentials.email,
      RECIPE_GENIE_E2E_PASSWORD: credentials.password,
    },
  })
  if (bootstrap.status !== 0) {
    fail((bootstrap.stderr || bootstrap.stdout || 'fixture bootstrap failed').trim())
  }

  console.log('Local authenticated browser environment is ready.')
  console.log('Run npm run test:e2e:inspect or npm run test:e2e:inspect:headed.')
} catch (error) {
  fail(error instanceof Error ? error.message : 'unknown error')
}
