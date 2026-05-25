import { execFileSync } from 'node:child_process'

const forbiddenPattern =
  /(^|\/)\.playwright\/|^\.codex-artifacts\/|^\.Codex\/|(^|\/)test-results\/|(^|\/)playwright-report\/|\.log$|\.trace$|\.webm$/i

const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
  encoding: 'utf8',
})

const violations = output
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => forbiddenPattern.test(file.replace(/\\/g, '/')))

if (violations.length > 0) {
  console.error('Forbidden generated artifacts are staged:\n' + violations.join('\n'))
  process.exit(1)
}

console.log('staged artifact policy passed.')
