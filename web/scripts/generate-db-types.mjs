import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const [targetPath, ...generationArgs] = process.argv.slice(2)

if (!targetPath || generationArgs.length === 0) {
  console.error('Usage: node scripts/generate-db-types.mjs <target> <supabase gen types args>')
  process.exit(1)
}

const cliArgs = ['supabase', '--workdir', '..', 'gen', 'types', 'typescript', ...generationArgs]
const isWindows = process.platform === 'win32'

if (cliArgs.some((arg) => !/^[\w./:-]+$/.test(arg))) {
  console.error('Supabase generation arguments contain unsupported characters.')
  process.exit(1)
}

const result = isWindows
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx.cmd ${cliArgs.join(' ')}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  : spawnSync('npx', cliArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })

if (result.error) {
  console.error(`Failed to launch Supabase CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

fs.writeFileSync(targetPath, result.stdout.replace(/\r\n/g, '\n'), 'utf8')
console.log(`Generated Supabase types at ${targetPath}.`)
