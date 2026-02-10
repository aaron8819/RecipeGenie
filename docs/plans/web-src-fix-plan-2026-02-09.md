# Implementation Plan: Fix Web/src Review Findings

Date: 2026-02-09
Owner: Codex (GPT-5)
Scope: `web/src` fixes for findings and test gaps from `docs/analysis/web-src-code-review-2026-02-09.md`

## Goals

- Fix all high and medium severity findings.
- Address the specified low severity findings where low-cost.
- Add tests for all identified test gaps.
- Align behavior with the clarified requirement: checked items stay in the shopping list and do not go to pantry.

## Plan

1. Fix tag-loss on recipe update.
   - Update `useUpdateRecipe` to only send `tags` when explicitly provided.
   - Ensure optimistic updates preserve existing tags when omitted.
   - Files: `web/src/hooks/use-recipes.ts`.

2. Harden URL safety against IPv4-mapped IPv6 private addresses.
   - Detect IPv4-mapped IPv6 (e.g., `::ffff:x.y.z.w`) and validate the mapped IPv4 with the existing private IP checks.
   - Add unit tests covering `::ffff:10.*`, `::ffff:192.168.*`, `::ffff:172.16.*`, and `::ffff:127.*`.
   - Files: `web/src/lib/url-safety.ts`, `web/src/lib/__tests__/url-safety.test.ts`.

3. Fix auth session expiry handling and `useRecipe` guard.
   - Track latest session/user in a ref and use it in `onAuthStateChange`.
   - Guard `useRecipe` with `enabled: !!id && !!user` and return early when no user.
   - Add a test (or lightweight unit) that verifies the auth callback clears queries after a user logs in then expires.
   - Files: `web/src/lib/auth-context.tsx`, `web/src/hooks/use-recipes.ts`.

4. Align shopping list regeneration with pantry-only `already_have` and preserved checked items.
   - Preserve checked items using `currentList.items.filter(i => i.checked)`.
   - Keep checked items in `items` (with `checked: true`) and do not move to `already_have`.
   - Ensure `already_have` remains pantry-only (items explicitly moved to pantry).
   - Add tests for regeneration behavior.
   - Files: `web/src/hooks/shopping/use-shopping-list.ts`, `web/src/lib/__tests__/shopping-list.test.ts` (or add a new test file).

5. Stabilize `useRecipes` query keys and auth-gate pantry queries.
   - Replace raw `options` object in query key with stable fields (e.g., explicit tuple or serialized key).
   - Add `enabled: !!user` to pantry queries that expect auth.
   - Files: `web/src/hooks/use-recipes.ts`, `web/src/hooks/use-pantry.ts`.

## Test Plan

1. Unit: `use-recipes` update should not clear tags when `tags` is omitted.
2. Unit: `url-safety` blocks IPv4-mapped IPv6 private ranges.
3. Unit: shopping list regeneration preserves checked items without moving them to pantry.
4. Unit: auth context clears queries on session expiry after a login (stale-closure case).

## Acceptance Criteria

1. Updating a recipe’s name or servings does not change its tags unless tags are explicitly provided.
2. Recipe import rejects IPv4-mapped IPv6 private destinations.
3. Regenerating a shopping list keeps checked items checked in `items`, and `already_have` contains only pantry items.
4. No runtime crash in `useRecipe` when auth is still loading.
5. Pantry queries do not execute until a user is present.
6. All new/updated tests pass.
