import { spawnSync } from 'node:child_process'

export const VERIFICATION_STATUS = {
  complete: 'COMPLETE',
  actionRequired: 'ACTION REQUIRED',
  blocked: 'BLOCKED',
}

const STATUS_PRIORITY = {
  [VERIFICATION_STATUS.complete]: 0,
  [VERIFICATION_STATUS.actionRequired]: 1,
  [VERIFICATION_STATUS.blocked]: 2,
}

export function selectFinalStatus(statuses) {
  return statuses.reduce((selected, status) => {
    if (!(status in STATUS_PRIORITY)) {
      throw new Error(`Unknown verification status: ${status}`)
    }
    return STATUS_PRIORITY[status] > STATUS_PRIORITY[selected] ? status : selected
  }, VERIFICATION_STATUS.complete)
}

export function decideLocalPreparation({
  configPresent,
  configMatchesRuntime,
  localSupabaseReady,
  localAuthenticationReady,
}) {
  if (!localSupabaseReady) {
    return {
      decision: 'start-local-supabase',
      status: VERIFICATION_STATUS.actionRequired,
    }
  }
  if (!configPresent || !configMatchesRuntime) {
    return {
      decision: 'generate-worktree-config',
      status: VERIFICATION_STATUS.complete,
    }
  }
  if (!localAuthenticationReady) {
    return {
      decision: 'local-reset-required',
      status: VERIFICATION_STATUS.actionRequired,
    }
  }
  return {
    decision: 'reuse-ready-environment',
    status: VERIFICATION_STATUS.complete,
  }
}

export function assertSafeInheritedLocalConfig(environment, expected) {
  const exactValues = {
    RECIPE_GENIE_E2E_TARGET: 'local',
    RECIPE_GENIE_E2E_LOCAL_ONLY: 'true',
    RECIPE_GENIE_E2E_BASE_URL: expected.appOrigin,
    NEXT_PUBLIC_SUPABASE_URL: expected.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: expected.anonKey,
    RECIPE_GENIE_E2E_EMAIL: expected.email,
    RECIPE_GENIE_E2E_PASSWORD: expected.password,
  }

  for (const [name, expectedValue] of Object.entries(exactValues)) {
    const inherited = environment[name]
    if (inherited !== undefined && inherited !== expectedValue) {
      throw new Error(
        `Recipe import verification rejects inherited ${name}; unset it or use the approved loopback-local value`
      )
    }
  }

  if (environment.RECIPE_GENIE_E2E_ALLOW_PRODUCTION === 'true') {
    throw new Error(
      'Recipe import verification rejects RECIPE_GENIE_E2E_ALLOW_PRODUCTION'
    )
  }
  if (environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Recipe import verification does not accept an inherited service-role key'
    )
  }
}

export function buildLocalE2EConfig({
  appOrigin,
  supabaseUrl,
  anonKey,
  email,
  password,
}) {
  return [
    'RECIPE_GENIE_E2E_TARGET=local',
    'RECIPE_GENIE_E2E_LOCAL_ONLY=true',
    `RECIPE_GENIE_E2E_BASE_URL=${appOrigin}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `RECIPE_GENIE_E2E_EMAIL=${email}`,
    `RECIPE_GENIE_E2E_PASSWORD=${password}`,
    '',
  ].join('\n')
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value ?? '')
    .replace(
      /https?:\/\/[^/\s:@]+:[^/\s@]+@/gi,
      'http://[REDACTED]@'
    )
    .replace(
      /((?:password|token|anon[_-]?key|service[_-]?role[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]'
    )

  for (const secret of secrets) {
    if (!secret) continue
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

export function runChildCommand({
  command,
  args,
  cwd,
  env,
  secrets = [],
  spawn = spawnSync,
}) {
  const result = spawn(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  })
  const output = redactSecrets(
    `${result.stdout || ''}${result.stderr || ''}`,
    secrets
  ).trim()

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output,
  }
}
