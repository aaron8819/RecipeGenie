// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { REQUIRED_SMOKE_JOURNEYS, smokeDiscoveryInvocation, validateSmokeJourneys } from './check-smoke-tests.mjs'

function listing(journeys = REQUIRED_SMOKE_JOURNEYS, project = 'smoke') {
  return ['Listing tests:', ...journeys.map(([file, title], index) =>
    `  [${project}] › ${file}:${index + 1}:3 › Suite › ${title} @core @smoke`),
  `Total: ${journeys.length} tests`].join('\n')
}

describe('required smoke journeys', () => {
  it('accepts complete selected journeys despite changed line numbers or extra tests', () => {
    expect(validateSmokeJourneys(listing([...REQUIRED_SMOKE_JOURNEYS,
      ['new.spec.ts', 'additional protection']]))).toBe(10)
  })

  it.each(REQUIRED_SMOKE_JOURNEYS)('rejects loss of %s: %s despite a sufficient count',
    (file, title) => {
      const replaced = REQUIRED_SMOKE_JOURNEYS.filter(entry =>
        entry[0] !== file || entry[1] !== title)
      replaced.push(['unrelated.spec.ts', 'unrelated filler'])
      const output = listing(replaced)
      expect(output.match(/\[smoke\]\s+›/g)).toHaveLength(9)
      expect(() => validateSmokeJourneys(output)).toThrow(`${file}: ${title}`)
    })

  it('rejects another project and empty or malformed collection', () => {
    for (const output of [listing(undefined, 'chromium'), '', 'Total: 9 tests',
      listing().replaceAll(' › ', ' > ')]) {
      expect(() => validateSmokeJourneys(output)).toThrow('Missing required smoke journeys')
    }
  })

  it('binds titles to their owning files and rejects duplicate identities', () => {
    expect(() => validateSmokeJourneys(listing().replaceAll('recipes.spec.ts', 'other.spec.ts')))
      .toThrow('recipes.spec.ts')
    expect(() => validateSmokeJourneys(listing([...REQUIRED_SMOKE_JOURNEYS,
      REQUIRED_SMOKE_JOURNEYS[0]]))).toThrow('Duplicate smoke journey')
  })

  it('accepts Windows paths and CRLF list output', () => {
    const output = listing().replaceAll(' › smoke-critical', ' › tests\\smoke-critical')
      .replaceAll('\n', '\r\n')
    expect(validateSmokeJourneys(output)).toBe(9)
  })
})


it('discovery is list-only with a fixed loopback config and no inherited secrets or hooks', () => {
  const invocation = smokeDiscoveryInvocation({
    PATH: '/runtime', SystemRoot: 'C:\\Windows',
    GH_TOKEN: 'forbidden', NODE_OPTIONS: '--require=unsafe', npm_execpath: '/unsafe/npm',
    RECIPE_GENIE_E2E_TARGET: 'production', RECIPE_GENIE_E2E_PASSWORD: 'private-placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'private',
  })
  expect(invocation.command).toBe(process.execPath)
  expect(invocation.args).toContain('--list')
  expect(invocation.args).toContain('--reporter=list')
  expect(invocation.args).not.toContain('run')
  expect(invocation.options.env.RECIPE_GENIE_E2E_TARGET).toBe('local')
  expect(invocation.options.env.RECIPE_GENIE_E2E_PASSWORD).toBe('discovery-only-placeholder')
  for (const key of ['GH_TOKEN', 'NODE_OPTIONS', 'npm_execpath', 'SUPABASE_SERVICE_ROLE_KEY']) {
    expect(invocation.options.env).not.toHaveProperty(key)
  }
  expect(invocation.options.env.PATH).toBe('/runtime')
  expect(invocation.options.env.SystemRoot).toBe('C:\\Windows')
})
