# Web/src Comprehensive Code Review (Focused)

Date: 2026-02-09
Reviewer: Codex (GPT-5)
Scope: `web/src` (Next.js + React Query + Supabase)

## Executive Summary

Key issues to address are a security bypass in URL safety (IPv4-mapped IPv6), a correctness bug that can wipe recipe tags on update, and several auth/list state handling issues. There is also a clarified product requirement: **checked shopping items should not go to pantry**, and `already_have` should represent pantry items only.

## Findings (ordered by severity)

### 1) High - Tags can be wiped on partial recipe updates

- Evidence: `web/src/hooks/use-recipes.ts:232`, `web/src/hooks/use-recipes.ts:259`
- Problem: `useUpdateRecipe` normalizes `tags` to `[]` when `updates.tags` is omitted, so any update that does not explicitly include tags clears them.
- Impact: data loss (tags removed) on routine edits (name, servings, etc.).
- Recommendation: only include `tags` in the update payload when `updates.tags` is defined, or merge with the existing tags before updating.
- Status: Resolved (2026-02-10). Fix in `web/src/hooks/use-recipes.ts` with regression test in `web/src/hooks/__tests__/use-recipes.test.ts`.

### 2) High - SSRF bypass via IPv4-mapped IPv6

- Evidence: `web/src/lib/url-safety.ts:53`
- Problem: `isPrivateIpAddress` blocks only `::ffff:127.*` but not other IPv4-mapped private ranges such as `::ffff:10.0.0.0/8`, `::ffff:192.168.0.0/16`, `::ffff:172.16.0.0/12`, etc.
- Impact: authenticated users could bypass private-IP checks in the recipe import API and reach internal services.
- Recommendation: detect IPv4-mapped IPv6 addresses and apply IPv4 private-range checks to the mapped address (not just 127.*).
- Status: Resolved (2026-02-10). Fix in `web/src/lib/url-safety.ts` with tests in `web/src/lib/__tests__/url-safety.test.ts`.

### 3) Medium - Auth session expiry detection uses stale state

- Evidence: `web/src/lib/auth-context.tsx:46-59`
- Problem: `hadSession` is derived from a stale closure variable (`user`), so session expiry may not clear queries after a user logs in.
- Impact: stale data can linger after session expiry, and UI can show out-of-date data until navigation.
- Recommendation: use a `useRef` to track the latest session state or derive from `session` inside the callback.
- Status: Resolved (2026-02-10). Fix in `web/src/lib/auth-context.tsx` with test in `web/src/lib/__tests__/auth-context.test.ts`.

### 4) Medium - `useRecipe` can throw before auth resolves

- Evidence: `web/src/hooks/use-recipes.ts:93-107`
- Problem: `user!.id` is accessed when `enabled: !!id` only. If `id` is present before auth is ready, this throws.
- Impact: runtime errors on initial load or deep links.
- Recommendation: guard the query with `enabled: !!id && !!user` and/or early return when `user` is null.
- Status: Resolved (2026-02-10). Fix in `web/src/hooks/use-recipes.ts`.

### 5) Medium - Shopping list regeneration preserves checked items incorrectly

- Evidence: `web/src/hooks/shopping/use-shopping-list.ts:79-96`
- Problem: regeneration preserves items by reading from `already_have`, but checked state is stored in `items[].checked`. Also, per requirement, `already_have` should be pantry only.
- Impact: checked items can be lost or misrouted into pantry, which is now undesired behavior.
- Recommendation: preserve checked items based on `items[].checked` and keep them in `items` (checked but not moved). `already_have` should contain only pantry items.
- Status: Resolved (2026-02-10). Fix in `web/src/hooks/shopping/use-shopping-list.ts` with regression test in `web/src/hooks/__tests__/shopping-list-checked-state.test.ts`.

### 6) Low - Unstable `useRecipes` query keys can cause refetch churn

- Evidence: `web/src/hooks/use-recipes.ts:26-30`
- Problem: the raw `options` object is used in the query key; if callers pass new objects each render, the key changes and invalidates caching.
- Impact: unnecessary refetching and performance regression for list views.
- Recommendation: use a stable key (serialize options or use explicit key fields) or require memoized options.
- Status: Resolved (2026-02-10). Fix in `web/src/hooks/use-recipes.ts` with stable key builder.

### 7) Low - Auth-gated queries run without explicit `enabled` guards

- Evidence: `web/src/hooks/use-pantry.ts:12-35`, `web/src/hooks/use-pantry.ts:96-122`
- Problem: some queries rely on RLS without gating for `user`.
- Impact: noisy errors during auth initialization and harder-to-handle UI states.
- Recommendation: add `enabled: !!user` where appropriate and handle unauthenticated states explicitly.
- Status: Resolved (2026-02-10). Fix in `web/src/hooks/use-pantry.ts`.

## Resolved Assumptions

- Requirement clarified: **checked items should not go into pantry**. Only items explicitly added to pantry should appear in `already_have`.

## Test Gaps

1. Partial recipe update should preserve tags if `tags` is omitted in the update payload. (Resolved; `web/src/hooks/__tests__/use-recipes.test.ts`)
2. URL safety should block IPv4-mapped IPv6 private addresses. (Resolved; `web/src/lib/__tests__/url-safety.test.ts`)
3. Shopping list regeneration should preserve checked items without moving them into `already_have` (pantry-only). (Resolved; `web/src/hooks/__tests__/shopping-list-checked-state.test.ts`)
4. Auth context should clear cached queries on session expiry after a user logs in (stale-closure case). (Resolved; `web/src/lib/__tests__/auth-context.test.ts`)

## Tests

- `npm test -- --run` (2026-02-10): all tests passed (17 files, 222 tests). Warning: Vite CJS deprecation notice emitted.
