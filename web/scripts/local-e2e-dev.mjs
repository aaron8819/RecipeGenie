import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOCAL_APP_ORIGIN,
  assertLocalRuntimeConfig,
  parseEnv,
} from './local-e2e-runtime.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(webRoot, '.env.e2e.local')
if (!fs.existsSync(envPath)) {
  console.error('Local E2E configuration is missing. Run npm run local:e2e:bootstrap first.')
  process.exit(1)
}

const values = parseEnv(fs.readFileSync(envPath, 'utf8'))
let runtime
try {
  runtime = assertLocalRuntimeConfig(values, process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local E2E runtime configuration is invalid')
  process.exit(1)
}
const url = new URL(LOCAL_APP_ORIGIN)
console.log(`Starting Recipe Genie at ${LOCAL_APP_ORIGIN} with local-only Supabase.`)

const result = spawnSync(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', url.hostname, '--port', url.port],
  {
    cwd: webRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...values,
      NEXT_PUBLIC_SUPABASE_URL: runtime.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: runtime.anonKey,
      JITI_CACHE: 'false',
    },
  }
)
process.exit(result.status ?? 1)
