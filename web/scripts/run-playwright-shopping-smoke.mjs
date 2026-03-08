import { spawnSync } from 'node:child_process'

const port = process.env.PLAYWRIGHT_SHOPPING_SMOKE_PORT || '3101'
const baseURL = `http://127.0.0.1:${port}`

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', 'tests/shopping-mode-smoke.spec.ts', '--project=smoke'],
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_WEB_SERVER_COMMAND: `npm run dev -- --port ${port}`,
      PLAYWRIGHT_REUSE_EXISTING_SERVER: '0',
    },
  }
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
