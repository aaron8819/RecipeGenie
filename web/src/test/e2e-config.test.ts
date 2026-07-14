import { describe, expect, it } from 'vitest'
import { assertAllowedOrigin, createE2EConfig, PRODUCTION_ORIGIN } from '../../tests/e2e-config'

const fakeCredentials = {
  RECIPE_GENIE_E2E_EMAIL: 'playwright-user@example.invalid',
  RECIPE_GENIE_E2E_PASSWORD: 'fake-password-for-tests-only',
}

function localEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...fakeCredentials,
    RECIPE_GENIE_E2E_TARGET: 'local',
    RECIPE_GENIE_E2E_BASE_URL: 'http://127.0.0.1:3107',
    ...overrides,
  }
}

describe('Playwright E2E configuration', () => {
  it.each([
    ['RECIPE_GENIE_E2E_EMAIL'],
    ['RECIPE_GENIE_E2E_PASSWORD'],
    ['RECIPE_GENIE_E2E_TARGET'],
  ])('fails safely when %s is missing', (key) => {
    const env = localEnv({ [key]: undefined })
    expect(() => createE2EConfig(env)).toThrow(key)
  })

  it('never includes credential values in validation errors', () => {
    const env = localEnv({
      RECIPE_GENIE_E2E_TARGET: 'production',
      RECIPE_GENIE_E2E_BASE_URL: PRODUCTION_ORIGIN,
    })
    try {
      createE2EConfig(env)
      throw new Error('Expected configuration validation to fail')
    } catch (error) {
      expect(String(error)).not.toContain(fakeCredentials.RECIPE_GENIE_E2E_EMAIL)
      expect(String(error)).not.toContain(fakeCredentials.RECIPE_GENIE_E2E_PASSWORD)
    }
  })

  it('requires explicit production opt-in', () => {
    expect(() => createE2EConfig({
      ...fakeCredentials,
      RECIPE_GENIE_E2E_TARGET: 'production',
      RECIPE_GENIE_E2E_BASE_URL: PRODUCTION_ORIGIN,
    })).toThrow('RECIPE_GENIE_E2E_ALLOW_PRODUCTION=true')
  })

  it('accepts only the expected local port and host contract', () => {
    expect(createE2EConfig(localEnv()).allowedOrigin).toBe('http://127.0.0.1:3107')
    expect(() => createE2EConfig(localEnv({ RECIPE_GENIE_E2E_BASE_URL: 'http://127.0.0.1:3108' }))).toThrow('port 3107')
    expect(() => createE2EConfig(localEnv({ RECIPE_GENIE_E2E_BASE_URL: 'http://recipe-genie.local:3107' }))).toThrow('localhost')
  })

  it('requires an exact approved HTTPS preview origin', () => {
    const preview = 'https://recipe-genie-abc123.vercel.app'
    expect(createE2EConfig({
      ...fakeCredentials,
      RECIPE_GENIE_E2E_TARGET: 'preview',
      RECIPE_GENIE_E2E_BASE_URL: preview,
      RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN: preview,
    }).allowedOrigin).toBe(preview)
    expect(() => createE2EConfig({
      ...fakeCredentials,
      RECIPE_GENIE_E2E_TARGET: 'preview',
      RECIPE_GENIE_E2E_BASE_URL: preview.replace('https:', 'http:'),
      RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN: preview.replace('https:', 'http:'),
    })).toThrow('HTTPS')
    expect(() => createE2EConfig({
      ...fakeCredentials,
      RECIPE_GENIE_E2E_TARGET: 'preview',
      RECIPE_GENIE_E2E_BASE_URL: preview,
    })).toThrow('RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN')
  })

  it('rejects URL-embedded credentials', () => {
    expect(() => createE2EConfig(localEnv({
      RECIPE_GENIE_E2E_BASE_URL: 'http://user:password@127.0.0.1:3107',
    }))).toThrow('embedded credentials')
  })
})

describe('exact origin guard', () => {
  const production = { allowedOrigin: PRODUCTION_ORIGIN }
  const local = { allowedOrigin: 'http://127.0.0.1:3107' }
  const preview = { allowedOrigin: 'https://recipe-genie-abc123.vercel.app' }

  it.each([
    [PRODUCTION_ORIGIN, production],
    ['http://127.0.0.1:3107/', local],
    ['https://recipe-genie-abc123.vercel.app/login', preview],
  ])('accepts approved exact origin %s', (url, config) => {
    expect(() => assertAllowedOrigin(url, config)).not.toThrow()
  })

  it.each([
    'https://recipe-genie-peach.vercel.app.evil.example',
    'https://recipe-genie-peach-vercel.app',
    'https://evilrecipe-genie-peach.vercel.app',
    'http://recipe-genie-peach.vercel.app',
    'https://recipe-genie-peach.vercel.app:444',
  ])('rejects lookalike, suffix, protocol, and port collision %s', (url) => {
    expect(() => assertAllowedOrigin(url, production)).toThrow('origin is not approved')
  })

  it('rejects a redirect before password entry', () => {
    expect(() => assertAllowedOrigin('https://unrelated.example/login', production, 'before password entry'))
      .toThrow('origin is not approved')
  })

  it('rejects an origin change between username and password', () => {
    expect(() => assertAllowedOrigin(PRODUCTION_ORIGIN, production, 'before username entry')).not.toThrow()
    expect(() => assertAllowedOrigin('https://unrelated.example', production, 'before password entry')).toThrow()
  })

  it('rejects an origin change immediately before submit', () => {
    expect(() => assertAllowedOrigin(PRODUCTION_ORIGIN, production, 'before password entry')).not.toThrow()
    expect(() => assertAllowedOrigin('https://unrelated.example', production, 'before sign-in submission')).toThrow()
  })
})
