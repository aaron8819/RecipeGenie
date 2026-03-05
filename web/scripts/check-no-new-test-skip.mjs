import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('tests')
const files = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (/\.spec\.ts$/i.test(entry.name)) {
      files.push(full)
    }
  }
}

function getCurrentDateIso() {
  return new Date().toISOString().slice(0, 10)
}

function extractExpiryDate(text) {
  const match = text.match(/\b(?:EXPIRY|EXPIRES|UNTIL)\b[^0-9]*(\d{4}-\d{2}-\d{2})/i)
  return match ? match[1] : null
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

walk(root)

const violations = []
let checked = 0
const today = getCurrentDateIso()

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

  let currentTestIsSmoke = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const testDecl = line.match(/^\s*test(?:\.(?:only|skip|fixme))?\s*\(\s*(["'`])([^"'`]*?)\1/)
    if (testDecl) {
      currentTestIsSmoke = testDecl[2].includes('@smoke')
    }

    const directiveMatch = line.match(/\b(test\.skip|describe\.skip|test\.fixme)\s*\(/)
    if (!directiveMatch) continue

    checked++
    const key = `${rel}:${i + 1}`

    const inSmokeContext = currentTestIsSmoke || line.includes('@smoke')
    if (inSmokeContext) {
      violations.push(`${key} ${directiveMatch[1]} is forbidden in @smoke tests`)
      continue
    }

    const contextText = `${lines[i - 1] || ''}\n${line}`
    const hasTicket = /\bISSUE-[A-Za-z0-9-]+\b/.test(contextText)
    const expiry = extractExpiryDate(contextText)

    if (!hasTicket || !expiry) {
      violations.push(`${key} ${directiveMatch[1]} requires ISSUE- tag and expiry date`) 
      continue
    }

    if (!isValidIsoDate(expiry)) {
      violations.push(`${key} invalid expiry format: ${expiry}`)
      continue
    }

    if (expiry < today) {
      violations.push(`${key} expiry ${expiry} is in the past`)
    }
  }
}

if (violations.length > 0) {
  console.error('Skip policy violations found:\n' + violations.join('\n'))
  process.exit(1)
}

console.log(`test skip policy passed: ${checked} skip/fixme directive(s) checked.`)
