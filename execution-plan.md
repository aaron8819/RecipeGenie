# Recipe Genie Execution Plan

Status legend: `[ ] not started`, `[~] in progress`, `[x] done`

This plan converts the architecture audit into PR-sized execution steps with guardrails first, no big-bang refactors, and `< 400 LOC` net change per PR unless codegen/migration baseline work.

## Constraints

- No big-bang refactors.
- Each PR should be reviewable in `< 400 LOC` net change unless purely codegen or baseline SQL snapshot.
- New guardrails must not deadlock delivery.
- Commit after every PR before starting the next PR.
- Required prevention checks: schema drift, import cycles, new `@ts-expect-error`, new `test.skip`.

## CI Checks (target state)

- `check:lint` -> `npm run lint`
- `check:typecheck` -> `npm run typecheck`
- `check:unit` -> `npm run test -- --run`
- `check:e2e-smoke` -> `npm run test:e2e:smoke`
- `check:migrations-smoke` -> migrate ephemeral DB from repo SQL
- `check:schema-drift` -> deterministic types/schema parity check
- `check:no-new-ts-expect-error` -> baseline non-increase
- `check:no-new-test-skip` -> ticketed allowlist enforcement
- `check:no-cycles` -> dependency graph cycle gate

---

## Phase 0A - Light Guardrails (fast, low-friction)

Definition of Done:
- Smoke E2E is isolated and running in CI.
- Skip usage is governed by policy and CI.
- Type debt cannot grow silently (`@ts-expect-error` guard active).
- Supabase generated type baseline exists.

1. `[ ]` **PR0.1 Supabase types baseline regen**
- Type: mechanical refactor (codegen)
- Files: `web/src/types/database.ts`, `web/package.json`, `README.md`
- Diff shape: large generated file replacement + small scripts/docs.
- Risk: generated type mismatches reveal hidden callsite issues.
- Verify: `npm run build` passes; `plan_templates` and RPCs appear in `Database`.

2. `[ ]` **PR0.5 Playwright split: smoke vs full**
- Type: behavior-changing
- Files: `web/playwright.config.ts`, `web/package.json`, `web/tests/README.md`
- Diff shape: add smoke project/tags/scripts; preserve full matrix path.
- Risk: accidental coverage drop if smoke not representative.
- Verify: smoke runs chromium-only critical flow set; full run unchanged.

3. `[ ]` **PR0.6 `test.skip` policy with ticketed allowlist**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`, `web/tests/README.md`
- Diff shape: CI grep/script requiring `ISSUE-` token for any skip.
- Risk: initial friction until existing skips are remediated/tagged.
- Verify: untagged `test.skip` fails CI; tagged skip passes.

4. `[ ]` **PR0.10 no-new `@ts-expect-error` guard**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`, `web/.quality-baseline.json`
- Diff shape: baseline counter + check script.
- Risk: temporary false negatives if baseline process is manual.
- Verify: adding one new `@ts-expect-error` fails CI.

---

## Phase 0B - Reproducibility and Deterministic Drift Controls

Definition of Done:
- Repo can bootstrap schema deterministically (or has explicit baseline strategy).
- CI migration smoke exists and is reliable.
- Schema/type drift check is deterministic (no remote-network dependency).

5. `[ ]` **PR0.3a Add canonical schema baseline snapshot**
- Type: behavior-changing
- Files: `supabase/schema.sql`, `supabase/SCHEMA.md`, `README.md`
- Diff shape: add baseline schema + docs declaring temporary source of truth.
- Risk: snapshot can drift quickly if not tied to process.
- Verify: snapshot generated from trusted environment and documented.

6. `[ ]` **PR0.3b Migration reconciliation strategy**
- Type: behavior-changing
- Files: `supabase/migrations/*`, `supabase/SCHEMA.md`, `README.md`
- Diff shape: either recover `001-011` or create explicit baseline migration path.
- Risk: high correctness risk if historical migrations are guessed.
- Verify: documented bootstrap path executes from empty DB.

7. `[ ]` **PR0.4 Migration smoke test in CI (ephemeral DB)**
- Type: mechanical refactor
- Files: `.github/workflows/ci.yml`, `README.md`
- Diff shape: add job to apply migrations/schema on clean DB.
- Risk: CI runtime increase and setup complexity.
- Verify: intentional broken SQL causes CI failure.

8. `[ ]` **PR0.2 Deterministic schema/types drift guard**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`, `scripts/*`, `supabase/schema.sql` (if snapshot-based)
- Diff shape: check-only parity gate; no remote regen dependency.
- Risk: if nondeterministic inputs are used, gate becomes flaky.
- Verify: local deterministic run reproducible; CI parity check stable across reruns.

---

## Phase 0C - Atomic Mutation Migrations (high value correctness)

Definition of Done:
- Three high-contention mutation paths are single-roundtrip atomic operations.
- Hook callsites consume typed RPC contracts with no `as any`.
- Concurrency tests exist for last-write/final-state integrity.

9. `[ ]` **PR0.7 Atomic shopping item toggle mutation**
- Type: behavior-changing
- Files: `supabase/migrations/022_atomic_toggle_shopping_item.sql`, `web/src/hooks/shopping/use-shopping-items.ts`, `web/src/types/database.ts`, `web/src/hooks/__tests__/use-shopping-items.test.ts`
- Diff shape: add RPC + replace read-modify-write path.
- Risk: wrong JSON update semantics can toggle incorrect items.
- Verify: compile-time RPC arg/return typing; concurrent toggle test passes.

10. `[ ]` **PR0.8 Atomic add-to-pantry-and-remove mutation**
- Type: behavior-changing
- Files: `supabase/migrations/023_atomic_add_pantry_and_remove_shopping.sql`, `web/src/hooks/shopping/use-shopping-pantry.ts`, `web/src/types/database.ts`, `web/src/hooks/__tests__/use-shopping-pantry.test.ts`
- Diff shape: one RPC replacing multi-step write+rollback.
- Risk: duplicate pantry behavior regression.
- Verify: duplicate and non-duplicate flows both pass tests.

11. `[ ]` **PR0.9 Atomic planner mark/unmark made mutation**
- Type: behavior-changing
- Files: `supabase/migrations/024_atomic_mark_recipe_made.sql`, `web/src/hooks/use-planner.ts`, `web/src/types/database.ts`, `web/src/hooks/__tests__/use-planner-history.test.ts`
- Diff shape: one RPC updates `recipe_history` + `weekly_plans`.
- Risk: week-specific state mismatch.
- Verify: mark/unmark roundtrip and interleaving test pass.

12. `[ ]` **PR0.11 RPC security hardening review**
- Type: behavior-changing
- Files: new/updated SQL migrations for RPC grants/policies, `supabase/SCHEMA.md`
- Diff shape: ensure invoker rights by default; `SECURITY DEFINER` only where required.
- Risk: over-restrictive grants break existing flows.
- Verify: authenticated user paths still work; unauthorized paths denied.

---

## Phase 1 - Drift and Integrity Cleanup

Definition of Done:
- Docs, defaults, and runtime behavior are aligned.
- Category taxonomy drift removed.
- Type suppression debt starts trending down.

13. `[ ]` **PR1.1 README env filename fix**
- Type: mechanical refactor
- Files: `README.md`
- Diff shape: command correction (`.env.example` usage).
- Risk: none.
- Verify: quick start commands run as written.

14. `[ ]` **PR1.2 Add explicit `typecheck` script + CI**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`
- Diff shape: add `tsc --noEmit` check.
- Risk: reveals existing debt.
- Verify: dedicated typecheck job green.

15. `[ ]` **PR1.3 Data migration: normalize `steak -> beef`**
- Type: behavior-changing
- Files: `supabase/migrations/025_normalize_steak_to_beef.sql`, `supabase/SCHEMA.md`
- Diff shape: SQL updates for defaults and existing config arrays.
- Risk: accidental user preference loss.
- Verify: no default config rows retain `steak`.

16. `[ ]` **PR1.4 App defaults: remove `steak` literals**
- Type: behavior-changing
- Files: `web/src/lib/user-config.ts`, `web/src/hooks/use-pantry.ts`, `web/src/hooks/shopping/use-shopping-categories.ts`, `web/scripts/migrate.ts`
- Diff shape: replace literals with canonical defaults constant.
- Risk: planner selection defaults may shift.
- Verify: unit tests assert canonical category set.

17. `[ ]` **PR1.5 Guest-mode drift resolution**
- Type: behavior-changing
- Files: `web/tests/authentication.spec.ts`, `web/tests/fixtures.ts`, `web/tests/README.md` (and related specs)
- Diff shape: remove or quarantine guest-mode tests/docs not backed by UI.
- Risk: may drop intended future coverage.
- Verify: no smoke tests reference missing guest UI.

18. `[ ]` **PR1.6 `@ts-expect-error` burn-down pass 1 (10 removals)**
- Type: mechanical refactor
- Files: selected hook files in `web/src/hooks/*`
- Diff shape: typed query/RPC helpers replacing suppressions.
- Risk: bad casts (`as unknown as`) hiding issues.
- Verify: baseline count decreases; no cast anti-pattern introduced.

19. `[ ]` **PR1.7 Query narrowing pass 1 (`select('*')` hotspots)**
- Type: behavior-changing
- Files: `web/src/hooks/use-planner.ts`, `web/src/hooks/use-recipes.ts`, `web/src/hooks/shopping/use-shopping-list.ts`
- Diff shape: explicit projections in high-traffic queries.
- Risk: missing columns break UI.
- Verify: smoke flows and unit tests pass; payload size reduced.

20. `[ ]` **PR1.8 Remove or fix existing skips (start with shopping suite)**
- Type: behavior-changing
- Files: `web/tests/shopping-list.spec.ts`
- Diff shape: convert skip-branches to deterministic assertions or move out of smoke.
- Risk: may expose existing flakes.
- Verify: smoke stable over 3 consecutive CI runs.

---

## Phase 2 - Boundaries and Incremental Decomposition

Definition of Done:
- Planner/recipes hook cycle is removed and protected by CI.
- Largest modules begin to shrink through extract-and-test slices.
- Shared mutation boilerplate reduced.

21. `[ ]` **PR2.1 Extract shared user-config hooks to break planner/recipes cycle**
- Type: mechanical refactor
- Files: `web/src/hooks/use-user-config.ts` (new), `web/src/hooks/use-planner.ts`, `web/src/hooks/use-recipes.ts`
- Diff shape: move shared config hooks into neutral module.
- Risk: query key drift.
- Verify: import graph cycle removed; behavior unchanged.

22. `[ ]` **PR2.2 Add cycle detection CI gate**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`, `web/.dependency-cruiser.cjs` (or equivalent)
- Diff shape: add `check:no-cycles`.
- Risk: config tuning needed to avoid noise.
- Verify: intentional synthetic cycle fails CI.

23. `[ ]` **PR2.3 Shopping hook optimistic boilerplate extraction**
- Type: mechanical refactor
- Files: `web/src/hooks/shopping/shared.ts`, targeted shopping hook files
- Diff shape: helper(s) for cancel/snapshot/rollback/invalidate pattern.
- Risk: subtle optimistic rollback divergence.
- Verify: existing shopping hook tests unchanged and passing.

24. `[ ]` **PR2.4 Remove component-level DB access from planner component**
- Type: behavior-changing
- Files: `web/src/components/planner/meal-planner.tsx`, `web/src/hooks/use-planner.ts`
- Diff shape: component calls hook/service only.
- Risk: stale cache timing differences.
- Verify: planner smoke flow unchanged; no direct `getSupabase()` in component.

25. `[ ]` **PR2.5 `meal-planner.tsx` slice 1: utility extraction**
- Type: mechanical refactor
- Files: `web/src/components/planner/meal-planner.tsx`, `web/src/components/planner/meal-planner.utils.ts`, tests
- Diff shape: move pure utility functions only.
- Risk: low.
- Verify: utility tests added; existing planner tests pass.

26. `[ ]` **PR2.6 `shopping-list.tsx` slice 1: selector extraction**
- Type: mechanical refactor
- Files: `web/src/components/shopping/shopping-list.tsx`, `web/src/components/shopping/shopping-list.selectors.ts`, tests
- Diff shape: move derived grouping/filtering selectors.
- Risk: ordering/grouping regressions.
- Verify: selector unit tests + smoke pass.

27. `[ ]` **PR2.7 `recipe-dialog.tsx` slice 1: validation/parser extraction**
- Type: mechanical refactor
- Files: `web/src/components/recipes/recipe-dialog.tsx`, `web/src/components/recipes/recipe-dialog.validation.ts`
- Diff shape: isolate pure validators/transforms.
- Risk: validation text regressions.
- Verify: recipe dialog and parser tests pass.

28. `[ ]` **PR2.8 Remove compatibility aliases after import migration**
- Type: behavior-changing
- Files: `web/src/hooks/use-auth.ts`, `web/src/hooks/use-shopping.ts`, callsites
- Diff shape: import rewrites + delete alias modules.
- Risk: missed imports.
- Verify: no alias import references remain; build green.

29. `[ ]` **PR2.9 Add optional guard for new `select('*')` in hooks**
- Type: mechanical refactor
- Files: `web/package.json`, `.github/workflows/ci.yml`
- Diff shape: warning or fail-on-new baseline check for wildcard selects.
- Risk: false positives.
- Verify: intentional new wildcard select triggers gate behavior.

---

## Phase 3 - Performance and Policy Tightening

Definition of Done:
- Perf budgets and analyzer are in CI.
- Lint policy tightened without major churn.
- Remaining legacy compatibility fallbacks removed or documented.

30. `[ ]` **PR3.1 Bundle analyzer + budget gate**
- Type: mechanical refactor
- Files: `web/next.config.js`, `web/package.json`, `.github/workflows/ci.yml`
- Diff shape: analyzer wiring + build-budget check script.
- Risk: noisy failures from normal dependency updates.
- Verify: budget regression intentionally fails CI.

31. `[ ]` **PR3.2 ESLint tightening step 1 (`no-unused-vars`)**
- Type: behavior-changing
- Files: `web/.eslintrc.json`, touched source files
- Diff shape: enable one rule and fix only local violations.
- Risk: diff creep.
- Verify: lint passes with rule on.

32. `[ ]` **PR3.3 ESLint tightening step 2 (`no-explicit-any`)**
- Type: behavior-changing
- Files: `web/.eslintrc.json`, targeted files
- Diff shape: enable with explicit local exceptions where justified.
- Risk: excessive cast workarounds.
- Verify: lint passes; no blanket disable comments.

33. `[ ]` **PR3.4 Remove planner localStorage backward-compat fallback**
- Type: behavior-changing
- Files: `web/src/components/planner/meal-planner.tsx`
- Diff shape: delete legacy fallback branches.
- Risk: legacy users lose local-only assignment data.
- Verify: assignments persist correctly via DB across reload/device.

34. `[ ]` **PR3.5 Query narrowing pass 2 (templates + share APIs)**
- Type: behavior-changing
- Files: `web/src/hooks/use-plan-templates.ts`, `web/src/app/api/recipe-shares/inbox/route.ts`, `web/src/app/api/recipe-shares/sent/route.ts`
- Diff shape: replace wildcard select usage with explicit fields.
- Risk: payload/field mismatch.
- Verify: share inbox/sent and templates UI still works.

35. `[ ]` **PR3.6 RPC/RLS contract integration tests**
- Type: behavior-changing
- Files: `web/tests/contracts/*`, `web/package.json`, `.github/workflows/ci.yml`
- Diff shape: add thin integration suite for critical RPC/policy expectations.
- Risk: environment complexity.
- Verify: broken RPC signature/policy causes contract test failure.

36. `[ ]` **PR3.7 Final docs alignment pass**
- Type: mechanical refactor
- Files: `README.md`, `project_overview.md`, `supabase/SCHEMA.md`, `web/tests/README.md`
- Diff shape: remove stale references and document all guardrails/checks.
- Risk: none.
- Verify: docs match actual scripts/config and no known drift items remain.

---

## Critical Smoke Flow Definition (for PR gating)

The smoke suite must cover this exact path:

1. Sign in
2. Create recipe
3. Add recipe to weekly plan
4. Add plan/recipe ingredients to shopping list
5. Check off item
6. Verify persistence after reload

---

## PR Sizing Notes

- Default max review size: `< 400 LOC net`.
- Exceptions:
  - Generated `database.ts` updates
  - Schema baseline snapshots
  - Migration SQL additions
- If a PR exceeds size limit and is not an exception, split before review.
