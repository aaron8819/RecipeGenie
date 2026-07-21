import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const LOCAL_APP_ORIGIN = 'http://127.0.0.1:3107'
export const LOCAL_SUPABASE_ORIGIN = 'http://127.0.0.1:54321'
export const PRODUCTION_PROJECT_REF = 'eyaoahwzixqetjgfghsh'

export function parseEnv(contents) {
  const values = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

export function assertLocalSupabaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Local E2E requires a valid Supabase URL')
  }

  if (
    url.origin !== LOCAL_SUPABASE_ORIGIN ||
    url.username ||
    url.password ||
    url.href.includes(PRODUCTION_PROJECT_REF)
  ) {
    throw new Error(`Local E2E requires exactly ${LOCAL_SUPABASE_ORIGIN}`)
  }
  return url.origin
}

export function assertLocalCredentialSource(values) {
  if (values.RECIPE_GENIE_E2E_TARGET !== 'local') {
    throw new Error('Local E2E credential source must declare target=local')
  }
  if (values.RECIPE_GENIE_E2E_BASE_URL !== LOCAL_APP_ORIGIN) {
    throw new Error(`Local E2E credential source must use ${LOCAL_APP_ORIGIN}`)
  }
  if (values.NEXT_PUBLIC_SUPABASE_URL) {
    assertLocalSupabaseUrl(values.NEXT_PUBLIC_SUPABASE_URL)
  }
  if (!values.RECIPE_GENIE_E2E_EMAIL || !values.RECIPE_GENIE_E2E_PASSWORD) {
    throw new Error('Local E2E email and password are required in an ignored environment file')
  }
  return {
    email: values.RECIPE_GENIE_E2E_EMAIL,
    password: values.RECIPE_GENIE_E2E_PASSWORD,
  }
}

function assertInheritedRuntimeValue(inheritedValues, name, expected) {
  const inheritedValue = inheritedValues[name]
  if (inheritedValue !== undefined && inheritedValue !== expected) {
    throw new Error(
      `Local E2E runtime conflicts with inherited ${name}; unset it or use the approved local value`
    )
  }
}

export function assertLocalRuntimeConfig(values, inheritedValues = {}) {
  const credentials = assertLocalCredentialSource(values)
  const supabaseUrlValue = values.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!supabaseUrlValue) {
    throw new Error('Local E2E runtime requires NEXT_PUBLIC_SUPABASE_URL')
  }
  const supabaseUrl = assertLocalSupabaseUrl(supabaseUrlValue)
  const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!anonKey) {
    throw new Error('Local E2E runtime requires NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  assertInheritedRuntimeValue(
    inheritedValues,
    'NEXT_PUBLIC_SUPABASE_URL',
    supabaseUrl
  )
  assertInheritedRuntimeValue(
    inheritedValues,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    anonKey
  )
  return { ...credentials, supabaseUrl, anonKey }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    env: options.env || process.env,
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

export function findLocalCredentials(webRoot) {
  const localPath = path.join(webRoot, '.env.e2e.local')
  if (fs.existsSync(localPath)) {
    return assertLocalCredentialSource(parseEnv(fs.readFileSync(localPath, 'utf8')))
  }

  const worktrees = run('git', ['worktree', 'list', '--porcelain'], { cwd: webRoot })
  if (!worktrees.ok) throw new Error('Could not inventory Git worktrees for local E2E credentials')

  for (const line of worktrees.output.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue
    const candidate = path.join(line.slice('worktree '.length), 'web', '.env.e2e.local')
    if (!fs.existsSync(candidate)) continue
    try {
      return assertLocalCredentialSource(parseEnv(fs.readFileSync(candidate, 'utf8')))
    } catch {
      // Ignore unrelated or non-local worktree configuration.
    }
  }

  throw new Error(
    'No safe local E2E credential source was found. Create web/.env.e2e.local with only the documented local target, email, and password values.'
  )
}

export function createLocalRuntime(webRoot) {
  if (Number(process.versions.node.split('.')[0]) !== 22) {
    throw new Error(`Local E2E requires Node 22; found ${process.version}`)
  }

  const supabaseCommand = path.join(
    webRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
  )
  if (!fs.existsSync(supabaseCommand)) {
    throw new Error('Supabase CLI is missing. Run npm ci from web/ with Node 22 and npm 10.')
  }

  const docker = run('docker', ['version', '--format', '{{.Server.Version}}'], { cwd: webRoot })
  if (!docker.ok) throw new Error('Docker is unavailable. Start Docker Desktop and retry.')

  const supabaseArgs = (args) => [...args, '--workdir', '..']
  const status = () => run(supabaseCommand, supabaseArgs(['status', '-o', 'env']), { cwd: webRoot })
  const start = () => run(supabaseCommand, supabaseArgs(['start']), { cwd: webRoot })
  const reset = () => run(
    supabaseCommand,
    supabaseArgs(['db', 'reset', '--local']),
    { cwd: webRoot }
  )

  return { status, start, reset }
}

export function localSupabaseEnvironment(output) {
  const values = parseEnv(output)
  const supabaseUrl = values.API_URL || values.SUPABASE_URL
  const anonKey = values.ANON_KEY || values.SUPABASE_ANON_KEY
  const serviceRoleKey = values.SERVICE_ROLE_KEY || values.SUPABASE_SERVICE_ROLE_KEY
  assertLocalSupabaseUrl(supabaseUrl || '')
  if (!anonKey || !serviceRoleKey) {
    throw new Error('Local Supabase status did not return the required local keys')
  }
  return { supabaseUrl, anonKey, serviceRoleKey }
}
