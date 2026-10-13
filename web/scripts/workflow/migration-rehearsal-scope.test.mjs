// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rehearsalScope, requiresMigrationRehearsals } from './migration-rehearsal-scope.mjs';

describe('migration rehearsal scope', () => {
  it('omits only historical rehearsals for styles and inert images', () => {
    expect(
      requiresMigrationRehearsals([
        'web/src/components/planner/planner-layout.css',
        'web/src/app/globals.css',
        'web/public/recipe-genie-mark.png',
      ]),
    ).toBe(false);
  });
  it.each([
    'supabase/migrations/033.sql',
    'supabase/config.toml',
    'supabase/tests/owner.sql',
    'web/src/components/planner/meal-planner.tsx',
    'web/src/hooks/use-planner.ts',
    'web/src/lib/shopping.ts',
    'web/src/types/database.ts',
    'web/qualification/combined-ui.spec.ts',
    'web/scripts/workflow/verification.mjs',
    'scripts/database/tests/Run-Tests.ps1',
    '.github/workflows/ci.yml',
    'web/package-lock.json',
    'unknown.css',
    'web/src/components/../hooks/owner.css',
    'web/src/components/planner/../../app/globals.css',
    'web/public/logo.svg',
  ])('retains rehearsals for sensitive or unknown %s', (file) => {
    expect(requiresMigrationRehearsals(['web/src/app/globals.css', file])).toBe(true);
  });
  it('fails closed for empty, malformed, missing or unresolved scope', () => {
    for (const files of [[], null, [null], [''], ['web\\src\\app\\globals.css']]) {
      expect(requiresMigrationRehearsals(files)).toBe(true);
    }
    expect(rehearsalScope('0'.repeat(40), 'a'.repeat(40))).toBe(true);
    expect(
      rehearsalScope('a'.repeat(40), 'b'.repeat(40), () => {
        throw Error();
      }),
    ).toBe(true);
  });
  it('includes both sides of renames and cannot hide a removed persistence file', () => {
    const base = 'a'.repeat(40),
      head = 'b'.repeat(40);
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return args[0] === 'rev-parse'
        ? `${args[2].slice(0, 40)}\n`
        : 'web/src/hooks/use-planner.ts\0web/src/components/planner/new.css\0';
    };
    expect(rehearsalScope(base, head, git)).toBe(true);
    expect(calls.at(-1)).toEqual(['diff', '--no-renames', '--name-only', '-z', base, head, '--']);
  });
  it('requires complete resolved scope before omitting rehearsals', () => {
    const base = 'a'.repeat(40),
      head = 'b'.repeat(40);
    const git = (args) =>
      args[0] === 'rev-parse' ? args[2].slice(0, 40) : 'web/src/app/globals.css\0';
    expect(rehearsalScope(base, head, git)).toBe(false);
    expect(rehearsalScope(base, head, (args) => (args[0] === 'rev-parse' ? head : ''))).toBe(true);
    expect(
      rehearsalScope(base, head, (args) =>
        args[0] === 'rev-parse' ? args[2].slice(0, 40) : 'web/src/app/globals.css',
      ),
    ).toBe(true);
  });

  it('keeps required job identity and database contracts outside the conditional', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('  migration-smoke-and-drift:');
    expect(workflow.match(/if: steps.rehearsal-scope.outputs.full != 'false'/g)).toHaveLength(2);
    expect(workflow).toContain('run: supabase test db --local supabase/tests');
    expect(workflow).toContain('run: npm run db:types:check');
    expect(workflow).toContain('run: supabase db reset --local');
  });
});
