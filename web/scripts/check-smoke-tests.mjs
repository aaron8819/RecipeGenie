import { execSync } from 'node:child_process'

const minSmokeTests = Number(process.env.SMOKE_MIN ?? 5)

let output = ''
try {
  output = execSync('npm run test:e2e:smoke -- --list', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(output)
} catch (error) {
  if (error.stdout) process.stdout.write(String(error.stdout))
  if (error.stderr) process.stderr.write(String(error.stderr))
  process.exit(typeof error.status === 'number' ? error.status : 1)
}

const smokeMatches = output.match(/\[smoke\]\s+›/g) ?? []
const smokeCount = smokeMatches.length

if (smokeCount < minSmokeTests) {
  console.error(
    `Smoke tripwire failed: found ${smokeCount} smoke tests, expected at least ${minSmokeTests}.`
  )
  process.exit(1)
}

console.log(
  `Smoke tripwire passed: found ${smokeCount} smoke tests (minimum ${minSmokeTests}).`
)
