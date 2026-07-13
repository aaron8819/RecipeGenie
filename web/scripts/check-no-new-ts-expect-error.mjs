import fs from 'node:fs'
import path from 'node:path'

const baseline = JSON.parse(fs.readFileSync('.quality-baseline.json', 'utf8'))
const maxAllowed = Number(process.env.TS_EXPECT_ERROR_BASELINE_OVERRIDE ?? baseline.tsExpectErrorCount)
const roots = ['src', 'tests', 'scripts']

function walk(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/i.test(entry.name)) {
      out.push(full)
    }
  }
}

const files = []
for (const root of roots) walk(root, files)

let current = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const matches = text.match(/\/\/\s*@ts-expect-error/g)
  current += matches ? matches.length : 0
}

if (current > maxAllowed) {
  console.error(`Found ${current} @ts-expect-error comments; baseline allows ${maxAllowed}.`)
  process.exit(1)
}

console.log(`ts-expect-error policy passed: ${current} <= ${maxAllowed}.`)
