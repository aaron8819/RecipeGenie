import { describe, expect, it } from 'vitest'
import {
  LOCAL_APP_ORIGIN,
  LOCAL_SUPABASE_ORIGIN,
  PRODUCTION_PROJECT_REF,
  assertLocalCredentialSource,
  assertLocalRuntimeConfig,
  assertLocalSupabaseUrl,
  localSupabaseEnvironment,
  parseEnv,
  resolveSupabaseCli,
} from './local-e2e-runtime.mjs'

const credentialSource = {
  RECIPE_GENIE_E2E_TARGET: 'local',
  RECIPE_GENIE_E2E_BASE_URL: LOCAL_APP_ORIGIN,
  RECIPE_GENIE_E2E_EMAIL: 'local@example.invalid',
  RECIPE_GENIE_E2E_PASSWORD: 'fake-password-for-tests-only',
}

const localRuntimeConfig = {
  ...credentialSource,
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_ORIGIN,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key-for-tests-only',
}

describe('local E2E runtime guards', () => {
  it('invokes the Windows Supabase shim relative to a worktree path with spaces', () => {
    const resolved = resolveSupabaseCli('C:\\worktrees\\Recipe Genie\\web', 'win32')
    expect(resolved).toEqual({
      absolutePath: 'C:\\worktrees\\Recipe Genie\\web\\node_modules\\.bin\\supabase.cmd',
      invocation: 'node_modules\\.bin\\supabase.cmd',
    })
  })

  it('accepts only the exact local Supabase origin', () => {
    expect(assertLocalSupabaseUrl(LOCAL_SUPABASE_ORIGIN)).toBe(LOCAL_SUPABASE_ORIGIN)
    for (const unsafe of [
      'https://example.supabase.co',
      'http://127.0.0.1:54322',
      'http://user:password@127.0.0.1:54321',
      'http://localhost:54321',
    ]) {
      expect(() => assertLocalSupabaseUrl(unsafe)).toThrow('requires exactly')
    }
  })

  it('rejects non-local credential sources before reading credentials', () => {
    expect(() => assertLocalCredentialSource({
      RECIPE_GENIE_E2E_TARGET: 'production',
      RECIPE_GENIE_E2E_BASE_URL: LOCAL_APP_ORIGIN,
      RECIPE_GENIE_E2E_EMAIL: 'local@example.invalid',
      RECIPE_GENIE_E2E_PASSWORD: 'fake-password-for-tests-only',
    })).toThrow('target=local')
  })

  it('accepts credential-only configuration for bootstrap discovery', () => {
    expect(assertLocalCredentialSource(credentialSource)).toEqual({
      email: credentialSource.RECIPE_GENIE_E2E_EMAIL,
      password: credentialSource.RECIPE_GENIE_E2E_PASSWORD,
    })
  })

  it('rejects runtime configuration without a Supabase URL', () => {
    expect(() => assertLocalRuntimeConfig(credentialSource))
      .toThrow('requires NEXT_PUBLIC_SUPABASE_URL')
  })

  it('rejects production-like and shared runtime Supabase URLs', () => {
    for (const supabaseUrl of [
      `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      'https://shared-project.supabase.co',
    ]) {
      expect(() => assertLocalRuntimeConfig({
        ...localRuntimeConfig,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      })).toThrow(`requires exactly ${LOCAL_SUPABASE_ORIGIN}`)
    }
  })

  it('rejects runtime configuration without an anon key', () => {
    const withoutAnonKey = { ...localRuntimeConfig }
    delete withoutAnonKey.NEXT_PUBLIC_SUPABASE_ANON_KEY
    expect(() => assertLocalRuntimeConfig(withoutAnonKey))
      .toThrow('requires NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('accepts only the complete approved local runtime configuration', () => {
    expect(assertLocalRuntimeConfig(localRuntimeConfig)).toEqual({
      email: credentialSource.RECIPE_GENIE_E2E_EMAIL,
      password: credentialSource.RECIPE_GENIE_E2E_PASSWORD,
      supabaseUrl: LOCAL_SUPABASE_ORIGIN,
      anonKey: localRuntimeConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })
  })

  it('accepts exactly matching inherited runtime configuration', () => {
    expect(assertLocalRuntimeConfig(localRuntimeConfig, {
      NEXT_PUBLIC_SUPABASE_URL: localRuntimeConfig.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localRuntimeConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })).toMatchObject({
      supabaseUrl: LOCAL_SUPABASE_ORIGIN,
      anonKey: localRuntimeConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })
  })

  it('rejects a conflicting inherited Supabase URL', () => {
    expect(() => assertLocalRuntimeConfig(localRuntimeConfig, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://shared-project.supabase.co',
    })).toThrow('conflicts with inherited NEXT_PUBLIC_SUPABASE_URL')
  })

  it('rejects a conflicting inherited Supabase anon key', () => {
    expect(() => assertLocalRuntimeConfig(localRuntimeConfig, {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'conflicting-anon-key',
    })).toThrow('conflicts with inherited NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('does not use inherited variables to complete credential-only configuration', () => {
    const inheritedValues = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://shared-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'inherited-anon-key',
    }

    expect(() => assertLocalRuntimeConfig(credentialSource, inheritedValues))
      .toThrow('requires NEXT_PUBLIC_SUPABASE_URL')
  })

  it('parses quoted local CLI values without logging them', () => {
    const parsed = parseEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY="anon"\nSERVICE_ROLE_KEY="role"')
    expect(localSupabaseEnvironment(parsedToText(parsed))).toEqual({
      supabaseUrl: LOCAL_SUPABASE_ORIGIN,
      anonKey: 'anon',
      serviceRoleKey: 'role',
    })
  })
})

function parsedToText(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
}
