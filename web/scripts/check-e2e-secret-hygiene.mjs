import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const failures = []
const legacyIdentifierHash = '9ab650cc1a4aa8bb150f8f20a4146e2a9f86acf801415c7d5667561945229718'
const passwordLiteralPattern = /(?:password\s*:\s*|RECIPE_GENIE_E2E_PASSWORD\s*=\s*)['"]([^'"]+)['"]/gi
const safePlaceholderPattern = /^(?:<[^>]+>|.*(?:example|fake|placeholder|for-tests-only).*)$/i

function fail(file, rule) {
  failures.push(`${file}: ${rule}`)
}

for (const file of tracked) {
  const normalized = file.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()

  if (lower.endsWith('/.env.e2e.local') || lower === '.env.e2e.local') {
    fail(file, 'tracked local E2E environment file')
  }
  if (/\/(?:\.playwright|playwright)\/auth\/.*\.json$/i.test(`/${normalized}`)) {
    fail(file, 'tracked Playwright authentication state')
  }

  if (!/^(?:web\/tests|web\/scripts|web\/playwright\.config)/.test(normalized)) continue

  let source
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }

  for (const match of source.matchAll(passwordLiteralPattern)) {
    if (!safePlaceholderPattern.test(match[1])) {
      fail(file, 'hardcoded password literal in E2E source')
      break
    }
  }
  if (/https?:\/\/[^\s'"/:]+:[^\s'"@]+@/i.test(source)) {
    fail(file, 'credential-bearing URL literal')
  }

  for (const match of source.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const fingerprint = createHash('sha256').update(match[0]).digest('hex')
    if (fingerprint === legacyIdentifierHash) {
      fail(file, 'forbidden legacy E2E account identifier')
      break
    }
  }
}

if (failures.length) {
  console.error('E2E secret hygiene guard failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('E2E secret hygiene guard passed.')
