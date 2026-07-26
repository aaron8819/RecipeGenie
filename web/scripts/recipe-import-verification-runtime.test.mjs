import { describe, expect, it, vi } from 'vitest'
import {
  VERIFICATION_STATUS,
  assertSafeInheritedLocalConfig,
  buildLocalE2EConfig,
  decideLocalPreparation,
  redactSecrets,
  runChildCommand,
  selectFinalStatus,
} from './recipe-import-verification-runtime.mjs'

const expected = {
  appOrigin: 'http://127.0.0.1:3107',
  supabaseUrl: 'http://127.0.0.1:54321',
  anonKey: 'local-anon-key-for-tests-only',
  email: 'local@example.invalid',
  password: 'fake-password-for-tests-only',
}

describe('recipe import verification orchestration', () => {
  it('accepts safe loopback-only inherited configuration', () => {
    expect(() => assertSafeInheritedLocalConfig({
      RECIPE_GENIE_E2E_TARGET: 'local',
      RECIPE_GENIE_E2E_LOCAL_ONLY: 'true',
      RECIPE_GENIE_E2E_BASE_URL: expected.appOrigin,
      NEXT_PUBLIC_SUPABASE_URL: expected.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: expected.anonKey,
    }, expected)).not.toThrow()
  })

  it('rejects inherited production-like Supabase configuration', () => {
    expect(() => assertSafeInheritedLocalConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://shared-project.supabase.co',
    }, expected)).toThrow('rejects inherited NEXT_PUBLIC_SUPABASE_URL')
  })

  it('detects missing worktree E2E configuration', () => {
    expect(decideLocalPreparation({
      configPresent: false,
      configMatchesRuntime: false,
      localSupabaseReady: true,
      localAuthenticationReady: true,
    })).toMatchObject({ decision: 'generate-worktree-config' })
  })

  it('builds the safe worktree configuration generation payload', () => {
    expect(buildLocalE2EConfig(expected)).toContain(
      'RECIPE_GENIE_E2E_LOCAL_ONLY=true'
    )
    expect(buildLocalE2EConfig(expected)).toContain(
      `NEXT_PUBLIC_SUPABASE_URL=${expected.supabaseUrl}`
    )
  })

  it('reports local Supabase unavailable behavior before other decisions', () => {
    expect(decideLocalPreparation({
      configPresent: false,
      configMatchesRuntime: false,
      localSupabaseReady: false,
      localAuthenticationReady: false,
    })).toEqual({
      decision: 'start-local-supabase',
      status: VERIFICATION_STATUS.actionRequired,
    })
  })

  it('reuses a ready local environment', () => {
    expect(decideLocalPreparation({
      configPresent: true,
      configMatchesRuntime: true,
      localSupabaseReady: true,
      localAuthenticationReady: true,
    })).toMatchObject({ decision: 'reuse-ready-environment' })
  })

  it('keeps fixture reset behind an explicit action boundary', () => {
    expect(decideLocalPreparation({
      configPresent: true,
      configMatchesRuntime: true,
      localSupabaseReady: true,
      localAuthenticationReady: false,
    })).toEqual({
      decision: 'local-reset-required',
      status: VERIFICATION_STATUS.actionRequired,
    })
  })

  it('propagates child-command failure', () => {
    const spawn = vi.fn(() => ({
      status: 7,
      stdout: 'scenario failed',
      stderr: '',
    }))
    expect(runChildCommand({
      command: 'node',
      args: ['fake-test.js'],
      cwd: '.',
      env: {},
      spawn,
    })).toMatchObject({
      ok: false,
      status: 7,
      output: 'scenario failed',
    })
  })

  it('redacts known secrets and credential-bearing URLs', () => {
    const secret = 'fake-password-for-tests-only'
    const credentialUrl = [
      'http://',
      'user:',
      secret,
      '@',
      '127.0.0.1:54321',
    ].join('')
    const output = redactSecrets(
      `password=${secret} ${credentialUrl}`,
      [secret]
    )
    expect(output).not.toContain(secret)
    expect(output).toContain('[REDACTED]')
  })

  it('uses blocked over action-required over complete final status', () => {
    expect(selectFinalStatus([
      VERIFICATION_STATUS.complete,
      VERIFICATION_STATUS.actionRequired,
    ])).toBe(VERIFICATION_STATUS.actionRequired)
    expect(selectFinalStatus([
      VERIFICATION_STATUS.actionRequired,
      VERIFICATION_STATUS.blocked,
      VERIFICATION_STATUS.complete,
    ])).toBe(VERIFICATION_STATUS.blocked)
  })
})
