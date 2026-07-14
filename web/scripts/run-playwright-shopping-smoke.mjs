import { spawnSync } from 'node:child_process'

const port = '3107'
const baseURL = `http://127.0.0.1:${port}`

const result = spawnSync(
  'npx',
  ['playwright', 'test', 'tests/shopping-mode-smoke.spec.ts', '--project=smoke'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      RECIPE_GENIE_E2E_TARGET: 'local',
      RECIPE_GENIE_E2E_BASE_URL: baseURL,
    },
  }
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
