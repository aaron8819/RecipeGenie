import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'

export const PRODUCTION_ORIGIN = 'https://recipe-genie-peach.vercel.app'
export const PRODUCTION_SUPABASE_PROJECT_REF = 'eyaoahwzixqetjgfghsh'
export const LOCAL_E2E_PORT = '3107'

export type E2ETarget = 'local' | 'preview' | 'production'

export type E2EConfig = {
  target: E2ETarget
  baseURL: string
  allowedOrigin: string
  email: string
  password: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export function assertAllowedOrigin(
  currentUrl: string,
  config: Pick<E2EConfig, 'allowedOrigin'>,
  stage = 'authentication'
) {
  let current: URL
  try {
    current = new URL(currentUrl)
  } catch {
    throw new Error(`Recipe Genie ${stage} origin validation failed: current page URL is invalid`)
  }

  if (current.username || current.password || current.origin !== config.allowedOrigin) {
    throw new Error(`Recipe Genie ${stage} origin validation failed: origin is not approved`)
  }
}

type Environment = Record<string, string | undefined>

function required(env: Environment, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required E2E environment variable: ${key}`)
  return value
}

function parseOrigin(value: string, variableName: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL`)
  }

  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain embedded credentials`)
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${variableName} must contain only an origin`)
  }

  return url
}

export function createE2EConfig(env: Environment): E2EConfig {
  const targetValue = required(env, 'RECIPE_GENIE_E2E_TARGET')
  if (!['local', 'preview', 'production'].includes(targetValue)) {
    throw new Error('RECIPE_GENIE_E2E_TARGET must be local, preview, or production')
  }
  const target = targetValue as E2ETarget
  const localOnly = env.RECIPE_GENIE_E2E_LOCAL_ONLY === 'true'
  const baseUrl = parseOrigin(
    required(env, 'RECIPE_GENIE_E2E_BASE_URL'),
    'RECIPE_GENIE_E2E_BASE_URL'
  )
  const supabaseUrl = parseOrigin(
    required(env, 'NEXT_PUBLIC_SUPABASE_URL'),
    'NEXT_PUBLIC_SUPABASE_URL'
  )

  if (
    (target === 'local' || localOnly) &&
    (supabaseUrl.hostname.includes(PRODUCTION_SUPABASE_PROJECT_REF) ||
      supabaseUrl.href.includes(PRODUCTION_SUPABASE_PROJECT_REF))
  ) {
    throw new Error('Production Supabase project is forbidden for this E2E configuration')
  }

  if (localOnly && target !== 'local') {
    throw new Error('RECIPE_GENIE_E2E_LOCAL_ONLY=true requires the local E2E target')
  }

  if (baseUrl.origin === PRODUCTION_ORIGIN && localOnly) {
    throw new Error('Production application origin is forbidden in local-only E2E mode')
  }

  if (target === 'local') {
    if (baseUrl.protocol !== 'http:') {
      throw new Error('Local E2E target must use HTTP')
    }
    if (!['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
      throw new Error('Local E2E target must use localhost or 127.0.0.1')
    }
    if (baseUrl.port !== LOCAL_E2E_PORT) {
      throw new Error(`Local E2E target must use port ${LOCAL_E2E_PORT}`)
    }
    if (
      supabaseUrl.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(supabaseUrl.hostname)
    ) {
      throw new Error('Local E2E target requires a loopback-local Supabase URL')
    }
  }

  if (target === 'preview') {
    const approvedPreview = parseOrigin(
      required(env, 'RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN'),
      'RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN'
    )
    if (baseUrl.protocol !== 'https:' || baseUrl.port) {
      throw new Error('Preview E2E target must use HTTPS with no explicit port')
    }
    if (!baseUrl.hostname.startsWith('recipe-genie-') || !baseUrl.hostname.endsWith('.vercel.app')) {
      throw new Error('Preview E2E target must use an approved Recipe Genie Vercel hostname')
    }
    if (baseUrl.origin !== approvedPreview.origin) {
      throw new Error('Preview base URL must exactly match the approved preview origin')
    }
  }

  if (target === 'production') {
    if (baseUrl.origin !== PRODUCTION_ORIGIN || baseUrl.port) {
      throw new Error(`Production E2E target must exactly match ${PRODUCTION_ORIGIN}`)
    }
    if (env.RECIPE_GENIE_E2E_ALLOW_PRODUCTION !== 'true') {
      throw new Error('Production E2E authentication requires RECIPE_GENIE_E2E_ALLOW_PRODUCTION=true')
    }
  }

  return {
    target,
    baseURL: baseUrl.origin,
    allowedOrigin: baseUrl.origin,
    email: required(env, 'RECIPE_GENIE_E2E_EMAIL'),
    password: required(env, 'RECIPE_GENIE_E2E_PASSWORD'),
    supabaseUrl: supabaseUrl.origin,
    supabaseAnonKey: required(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  }
}

let cachedConfig: E2EConfig | undefined

export function getE2EConfig(): E2EConfig {
  if (cachedConfig) return cachedConfig

  const localEnvPath = path.resolve(process.cwd(), '.env.e2e.local')
  if (fs.existsSync(localEnvPath)) {
    loadDotEnv({ path: localEnvPath, override: false, quiet: true })
  }

  cachedConfig = createE2EConfig(process.env)
  return cachedConfig
}
