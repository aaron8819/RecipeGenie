# Recipe Genie Comprehensive Code Review

Date: 2026-02-09
Reviewer: Codex (GPT-5)
Scope: `web/` app (Next.js + React Query + Supabase), with emphasis on correctness, performance, maintainability, and dead code.

## Executive Summary

The codebase has solid domain modeling and broad hook/test coverage, but there are several high-impact issues:

1. Security: authenticated users can trigger server-side fetches to arbitrary URLs (SSRF risk).
2. Correctness: shopping drag-and-drop reorder logic uses filtered indexes against unfiltered arrays (can reorder wrong items).
3. Reliability/tooling: CI-quality checks are currently broken (`lint` setup prompt, Vitest/esbuild binary mismatch, and production build failing with webpack errors in this environment).
4. Maintainability: large duplicated logic and dead/legacy paths are increasing complexity and review surface.

## What I Ran

- `npm run lint` (in `web/`) -> fails due interactive Next ESLint initialization prompt.
- `npm run test -- --run` (in `web/`) -> fails with `esbuild` host/binary version mismatch.
- `npm run build` and `CI=1 npm run build` -> fails with webpack errors (no diagnostics emitted in this environment).
- `npx tsc --noEmit` -> passes.
- Static review on major files and hot paths (planner/shopping/recipe hooks, middleware, API routes).

## Findings (ordered by severity)

## 1) High - SSRF exposure in recipe import API

- Evidence: `web/src/app/api/recipe-import/route.ts:42`, `web/src/app/api/recipe-import/route.ts:60`
- Problem: server endpoint accepts any URL from authenticated users and fetches it directly, with no private-network/IP restrictions, hostname allowlist, or protocol narrowing beyond `new URL(...)` parsing.
- Impact: authenticated users may be able to access internal network metadata/services from server runtime.
- Recommendation:
  - Enforce `https:` only.
  - Resolve and reject private/link-local/loopback destinations.
  - Add redirect hop limit and revalidate each redirect target.
  - Cap response size/content-type and add structured logging/rate limits.

## 2) High - Incorrect drag reorder logic in shopping list

- Evidence: `web/src/components/shopping/shopping-list.tsx:1175`, `web/src/components/shopping/shopping-list.tsx:1189`
- Problem: code computes `actualActiveIndex`/`actualOverIndex` in full list, but splices using `activeIndex`/`overIndex` from `filteredItems`.
- Impact: when filtered and full list indices diverge, reordering can move the wrong item, corrupting order/category updates.
- Recommendation:
  - Splice using `actualActiveIndex` and `actualOverIndex`.
  - Add regression tests covering filtered + pending-removal states.

## 3) High - Broken quality gates / non-deterministic CI readiness

- Evidence: `web/package.json:9`, `web/package.json:10`
- Problem:
  - `npm run lint` launches interactive setup prompt instead of running deterministic lint checks.
  - `npm run test -- --run` fails at startup (`esbuild` host/binary mismatch).
  - Build fails (`webpack errors`) without actionable output in this runtime.
- Impact: prevents reliable pre-merge validation and increases risk of shipping regressions.
- Recommendation:
  - Commit explicit ESLint config so lint is non-interactive in CI.
  - Clean/reinstall lockfile/deps to resolve `esbuild` mismatch; pin if needed.
  - Add CI pipeline that runs `lint`, `test`, `build` on fresh installs and publishes full logs/artifacts.

## 4) Medium - N+1 tag mutation patterns with partial-failure risk

- Evidence: `web/src/hooks/use-recipes.ts:632`, `web/src/hooks/use-recipes.ts:690`, `web/src/hooks/use-recipes.ts:744`
- Problem: tag rename/merge/delete issue one `update` per recipe via `Promise.all`, with no transaction boundary.
- Impact: slow at scale and can leave partially updated tag state if subset fails.
- Recommendation:
  - Move tag operations into a single SQL function/RPC transaction.
  - Return changed IDs/count for deterministic cache updates.

## 5) Medium - Tag filtering is done client-side after broad fetch

- Evidence: `web/src/hooks/use-recipes.ts:43`, `web/src/hooks/use-recipes.ts:66`
- Problem: `useRecipes` fetches broad recipe sets then filters tags in client JS.
- Impact: unnecessary payload and CPU for users with larger datasets.
- Recommendation:
  - Push OR tag matching to DB query (e.g., overlap operator / RPC) and keep client-side filtering only as fallback.

## 6) Medium - Unnecessary middleware auth refresh on broad route set

- Evidence: `web/src/middleware.ts:57`, `web/src/middleware.ts:72`
- Problem: middleware runs `supabase.auth.getUser()` on nearly all non-static paths.
- Impact: extra network/latency overhead on pages/routes that may not need auth refresh.
- Recommendation:
  - Narrow matcher to authenticated app surfaces.
  - Skip known public/auth callback endpoints where possible.

## 7) Medium - Inconsistent default category sources

- Evidence:
  - `web/src/lib/user-config.ts:5` (includes `steak`)
  - `web/src/hooks/use-recipes.ts:460` and `web/src/hooks/use-recipes.ts:467` (fallback defaults exclude `steak`)
  - `web/src/components/recipes/recipe-settings-modal.tsx:473` (reset defaults exclude `steak`)
- Problem: defaults differ depending on code path.
- Impact: confusing UX and migration behavior; category defaults can unexpectedly drift.
- Recommendation:
  - Centralize defaults in one exported source and consume it everywhere.

## 8) Medium - Unsafe auth assumption in `useRecipe`

- Evidence: `web/src/hooks/use-recipes.ts:101`, `web/src/hooks/use-recipes.ts:107`
- Problem: query uses `user!.id` but is enabled only on `!!id`.
- Impact: potential runtime exception if recipe query starts before auth state resolves.
- Recommendation:
  - Use `enabled: !!id && !!user` and guard in `queryFn`.

## 9) Medium - Dead and duplicate UI logic in shopping list component

- Evidence:
  - Duplicate `formatAmount` declarations: `web/src/components/shopping/shopping-list.tsx:253`, `web/src/components/shopping/shopping-list.tsx:632`, `web/src/components/shopping/shopping-list.tsx:1227`
  - Legacy swipe code still active despite being “disabled”: `web/src/components/shopping/shopping-list.tsx:286`, `web/src/components/shopping/shopping-list.tsx:397`
- Problem: stale paths and duplicate helpers inflate complexity and bug risk.
- Impact: harder maintenance and debugging; higher chance of inconsistent rendering behavior.
- Recommendation:
  - Remove unused `formatAmount` variant(s), extract shared formatter.
  - Delete dead swipe logic or fully re-enable it with clear tests.

## 10) Medium - Unused category settings component maintained in parallel

- Evidence:
  - Unused export-only component: `web/src/components/recipes/recipe-category-settings-modal.tsx:164`
  - Only referenced from barrel export: `web/src/components/recipes/index.ts:6`
  - Active component used in UI: `web/src/components/recipes/recipe-list.tsx:549`
- Problem: two large overlapping settings implementations exist, but one is not consumed.
- Impact: duplicate maintenance burden and drift risk.
- Recommendation:
  - Remove unused component or converge to one shared module.

## 11) Medium - Type safety debt hidden by widespread suppressions

- Evidence: 51 occurrences of `@ts-expect-error` in `web/src` (hook layer concentrated).
- Problem: systematic type suppression weakens compile-time guarantees and obscures real schema/type regressions.
- Impact: greater runtime risk during schema evolution.
- Recommendation:
  - Regenerate/align Supabase types and wrap DB calls with typed repository helpers.
  - Add CI guard to fail on new `@ts-expect-error` additions.

## 12) Low - `useTagsWithCounts` adds extra fetch dependency noise

- Evidence: `web/src/hooks/use-recipes.ts:508`, `web/src/hooks/use-recipes.ts:511`
- Problem: hook subscribes to `useRecipes()` mainly to vary query key with `recipes?.length`, but still fetches tags server-side itself.
- Impact: unnecessary coupling and potential extra recomputation.
- Recommendation:
  - Remove dependency on `useRecipes()` and invalidate directly from mutation success paths (already mostly done).

## Maintainability/Architecture Observations

- The codebase has good separation by domain in shopping hooks (`web/src/hooks/shopping/*`), but very large UI components (`meal-planner.tsx`, `shopping-list.tsx`) are carrying too much behavior/state.
- The migration from monolith to modular hooks is in progress, but stale compatibility and duplicate components remain.
- Data-layer patterns are repeated across hooks; a typed shared repository layer would reduce duplication and `@ts-expect-error` usage.

## Performance Opportunities (Prioritized)

1. Push tag filtering/counting operations to DB-side queries/RPCs (`useRecipes`, tag hooks).
2. Reduce middleware auth refresh scope to avoid per-request overhead on non-critical routes.
3. Remove full `useRecipes()` fetch in shopping view fallback path by consistently storing `recipeId` in shopping item sources.
4. Split large render-heavy components into smaller memoized units with clearer selector boundaries.

## Dead Code / Cleanup Candidates

- `RecipeCategorySettingsModal` appears unused by runtime UI:
  - `web/src/components/recipes/recipe-category-settings-modal.tsx`
  - `web/src/components/recipes/index.ts:6`
- Legacy swipe stack in shopping list remains wired while functionally disabled:
  - `web/src/components/shopping/shopping-list.tsx:286`
  - `web/src/components/shopping/shopping-list.tsx:397`
- Duplicate helper implementations in one file:
  - `web/src/components/shopping/shopping-list.tsx:253`
  - `web/src/components/shopping/shopping-list.tsx:632`
  - `web/src/components/shopping/shopping-list.tsx:1227`

## Recommended Action Plan

1. Stabilize the baseline:
   - make lint non-interactive,
   - fix test runtime dependency mismatch,
   - restore deterministic build diagnostics in CI.
2. Fix high-risk defects first:
   - SSRF hardening in `recipe-import` route,
   - shopping drag reorder index bug.
3. Reduce technical debt:
   - remove unused/duplicate components and helper code,
   - unify category defaults,
   - replace `@ts-expect-error` hotspots with typed DB helpers.
4. Improve scalability:
   - move tag operations/filtering to DB-side routines.

## Residual Risk / Gaps

- Could not obtain webpack diagnostic details from this environment despite repeated `next build` runs.
- No dynamic runtime profiling was executed; performance findings are based on code-path analysis and query patterns.
