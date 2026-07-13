# Production Release Audit — 2026-07-12

## Release changes

- Upgraded Next.js and `eslint-config-next` from 15.5.12 to 15.5.20 and direct PostCSS to 8.5.16.
- Upgraded Supabase JS from 2.90.1 to 2.110.0 and aligned `@supabase/ssr` from 0.5.2 to 0.12.0. The old SSR client generic was the source of `never` write/RPC inference.
- Upgraded React Query to 5.101.2, Playwright to 1.61.1, Axe Playwright to 4.12.1, and dependency-cruiser to 17.4.3.
- Applied all remaining stable patch/minor releases allowed by the existing ranges, including Radix UI primitives, Upstash Redis, tailwind-merge, Node/React types, TypeScript ESLint, Autoprefixer, and jsdom. Remaining `npm outdated` entries are majors, prereleases, or canaries.
- Migrated Vitest separately from 2.1.9 to 4.1.9. Vite 8 requires an explicit Oxc automatic-JSX transform because the Next.js TypeScript configuration preserves JSX.
- Pinned the stable Supabase CLI at 2.109.0 and added local Supabase configuration so type regeneration no longer depends on an unpinned `npx` release.
- Replaced shell redirection in type-generation commands with an explicit UTF-8 generator script so output is deterministic on Windows and Unix.
- Removed all 34 application `@ts-expect-error` suppressions. The quality baseline is now zero and the policy script counts directives rather than its own diagnostic strings.
- Made JSON-backed domain types structurally compatible with Supabase `Json`; removed the unsafe dynamic-select option from `useRecipes`.
- Stabilized authenticated E2E setup: each test receives a fresh login instead of cloning one revocable refresh token, stateful tests run with one worker, and local runs can reuse an existing server.
- Added direct authenticated E2E coverage for pasted-text recipe import and recipe-sharing authorization boundaries.

## Security findings

`npm audit fix` removed all critical and high findings. `npm audit --omit=dev` retains one moderate advisory chain: Next.js 15.5.20 bundles PostCSS below 8.5.10. The direct PostCSS dependency is patched. npm proposes downgrading Next.js to 9.3.3, which is unsafe and incorrect for this application, so the bundled finding is deferred pending a patched Next 15.5.x release. No `--force` operation was used.

Deferred majors: Next 16, React 19, Tailwind 4, ESLint 9/10, and other product-runtime majors. Vitest 4 was the only major migration and was required to remove a critical arbitrary-file-read/execution advisory with no patched Vitest 2/3 release.

## Verification

- `npm run verify`: pass (lint, TypeScript, 517 unit tests, zero suppressions, zero skipped tests, no dependency cycles).
- `npm run build`: pass on Next 15.5.20.
- Linked migration preflight: pass; local and remote migrations 001–004 align.
- Authenticated core E2E: pass, 16/16.
- Extended authenticated E2E: pass, 32/32. Coverage includes authentication, CRUD, pasted-text import, planner-to-shopping, optimistic/undo behavior, pantry, mobile shopping, recipe-sharing authorization, accessibility, and responsive layouts.

### Schema parity reconciliation

Repository history identified the drift source: unmerged backup commit `1f67b30` used version 003 for `003_recipe_audits.sql`, while main reused version 003 for `003_shopping_item_order_preferences.sql`. The linked schema also contained surrogate `id` columns, live-only `auth.uid()` defaults, and nullable/defaulted `user_id` columns that differed from main.

Read-only production checks found zero `recipe_audits` rows, zero null `user_id` values in affected tables, and no duplicate `user_id` rows in `user_config` or `shopping_list` (11 rows and 11 distinct users in each). After explicit approval, migration `004_reconcile_production_schema_to_main.sql` applied guarded reconciliation: it removed the empty abandoned feature table, removed obsolete surrogate keys, restored the one-row-per-user primary keys, and restored main's nullability/default contracts. The migration aborts atomically if any destructive precondition is no longer true.

Post-migration linked type generation confirms the drift is gone, and the committed generated types now come directly from the reconciled schema. Full static, unit, build, and authenticated browser verification passed after the change. Local migration replay remains unavailable until Docker Desktop is running; this is an environment limitation rather than an unresolved linked-schema mismatch.

## Performance and maintainability

The home route is 137 kB route JavaScript and 322 kB first-load JavaScript. It eagerly mounts visited planner, recipe, shopping, and pantry surfaces to preserve tab state. The highest-confidence optimization is to dynamically load each domain surface on first visit while retaining the current mounted-after-visit behavior. Measure the route before and after and require no regression in tab-state E2E tests. This audit does not introduce that refactor because the current release goal prioritizes stabilization.

## Ranked product backlog

1. Add deterministic per-run E2E account/data cleanup and seed helpers. The shared account currently accumulates recipes, shopping rows, exclusions, learned category order, and collapsed-section state, obscuring real failures.
2. Add shopping-list search/filter or a focused “recently added” affordance. Long lists with more than 100 rows made newly added recipe ingredients hard to verify and hard for users to find.
3. Add import-quality feedback that highlights ingredients or instruction groups the parser could not confidently structure, backed by representative recipe fixtures and measurable correction rates. Consider AI only for the low-confidence cases and compare it with the deterministic parser baseline.
