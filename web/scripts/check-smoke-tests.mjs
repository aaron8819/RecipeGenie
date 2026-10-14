import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Use the existing list command through this runtime's bundled npm, never a shell.
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run this guard through npm run test:e2e:smoke:list')
  const files = [...new Set(REQUIRED_SMOKE_JOURNEYS.map(([file]) => `tests/${file}`))]
  const result = spawnSync(process.execPath, [
    npmCli, 'run', 'test:e2e:smoke', '--', ...files, '--list',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })
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
