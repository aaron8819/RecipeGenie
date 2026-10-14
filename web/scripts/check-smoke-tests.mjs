import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REQUIRED_SMOKE_JOURNEYS = [
  [
    'smoke-critical-flow.spec.ts',
    'shows the Recipe Genie sign-in screen when unauthenticated',
  ],
  [
    'smoke-critical-flow.spec.ts',
    'loads isolated auth state and reaches the Recipe Genie shell deterministically',
  ],
  [
    'smoke-critical-flow.spec.ts',
    'redirects the authenticated app root to Recipes',
  ],
  [
    'smoke-critical-flow.spec.ts',
    'switches routes through the mobile bottom navigation',
  ],
  [
    'smoke-critical-flow.spec.ts',
    'keeps the active route across reloads',
  ],
  [
    'shopping-mode-smoke.spec.ts',
    'keeps shopping mode dense by default and reveals manage controls only on demand',
  ],
  [
    'shopping-mode-smoke.spec.ts',
    'keeps mobile quick actions and richer restore context available',
  ],
  [
    'recipes.spec.ts',
    'deletes an active recipe contribution through one visible confirmation',
  ],
  [
    'recipes.spec.ts',
    'preserves supported pantry and exclusion lifecycle actions across replacement',
  ],
]

export function validateSmokeJourneys(output) {
  const found = new Set()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*\[smoke\]\s+›\s+(.+?):\d+:\d+\s+›\s+(.+)$/.exec(line)
    if (!match) continue
    const file = path.posix.basename(match[1].replaceAll('\\', '/'))
    const title = match[2].split(' › ').at(-1).replace(/\s+@[\w-]+/g, '').trim()
    const identity = `${file}: ${title}`
    if (found.has(identity)) throw new Error(`Duplicate smoke journey: ${identity}`)
    found.add(identity)
  }
  const missing = REQUIRED_SMOKE_JOURNEYS
    .map(([file, title]) => `${file}: ${title}`)
    .filter(identity => !found.has(identity))
  if (missing.length) throw new Error(`Missing required smoke journeys:\n${missing.join('\n')}`)
  return found.size
}

// Discovery never inherits target credentials, npm lifecycle hooks or preloads.
// Playwright --list does not run fixtures, browsers or webServer. The fixed
// loopback values satisfy config parsing only, and cannot identify a real user.
export function smokeDiscoveryInvocation(environment = process.env) {
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME',
    'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => environment[key])
    .map(key => [key, environment[key]]))
  Object.assign(env, {
    CI: 'true',
    RECIPE_GENIE_E2E_TARGET: 'local',
    RECIPE_GENIE_E2E_LOCAL_ONLY: 'true',
    RECIPE_GENIE_E2E_BASE_URL: 'http://127.0.0.1:3107',
    RECIPE_GENIE_E2E_EMAIL: 'discovery-only@example.invalid',
    RECIPE_GENIE_E2E_PASSWORD: 'discovery-only-placeholder',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'discovery-only-placeholder',
  })
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  return { command: process.execPath, args: [
    path.join(web, 'node_modules', '@playwright', 'test', 'cli.js'), 'test',
    '--config', path.join(web, 'playwright.config.ts'), '--project=smoke',
    ...new Set(REQUIRED_SMOKE_JOURNEYS.map(([file]) => `tests/${file}`)),
    '--list', '--reporter=list',
  ], options: { cwd: web, env, encoding: 'utf8', windowsHide: true } }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { command, args, options } = smokeDiscoveryInvocation()
  const result = spawnSync(command, args, options)
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error || result.status !== 0) process.exit(result.status ?? 1)
  try {
    const count = validateSmokeJourneys(result.stdout)
    console.log(`Smoke journey tripwire passed: ${REQUIRED_SMOKE_JOURNEYS.length} required, ${count} listed.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid smoke journey list')
    process.exit(1)
  }
}
