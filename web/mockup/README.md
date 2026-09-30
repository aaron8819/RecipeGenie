# Dashboard design mockup

Local experience: <http://127.0.0.1:3115>

This is a separate Next.js app, not a production route. It never imports the
authenticated shell, data hooks, Supabase clients, or storage APIs. All edits
live in React memory and reset on reload or scenario reset. Existing routes,
the default landing page, the PWA manifest, and iPhone launch behavior are
unchanged. Navigation opens fixture versions of Recipes, Planner, Shopping,
and a read-only Pantry placeholder.

Review corrections: desktop keeps account/profile, Help, and Sign out; mobile
keeps the logo and profile button at the top, with no Help button, and fixed
five-destination navigation at the bottom. Account controls use fixture-only
feedback and never sign out a real account. Non-Dashboard destinations are
explicitly labeled placeholders. Dashboard meal cards, shopping-selection
modal, and searchable swap modal remain the proposed Dashboard designs.

## Run

From `web/`, with the project's Node 22.23.1 runtime and installed dependencies:

```powershell
node node_modules/next/dist/bin/next dev mockup --webpack --port 3115 --hostname 127.0.0.1
```

Webpack supports this worktree's dependency junction. There are no new package
dependencies. The local server is bound to loopback only.

## Behavioral references

- Planner: `src/components/planner/meal-planner.tsx` and its pure date helpers.
  Monday–Sunday is the default week. Every scheduled recipe appears, and a
  recipe can appear only once per week. Cooked meals can move or be removed;
  swap and per-meal shopping are unavailable. Removing a meal keeps its recipe.
- Shopping: the production `shopping-document.ts` reducers, ingredient resolver,
  and projector run against fixture documents. They own recipe contribution
  replacement, quantity aggregation, ordering, completion, and checked states.
  Re-adding an unchanged recipe does not multiply its quantities or reset checks.
- Quick add mirrors comma splitting, trimming, semantic purchase-identity
  duplicate detection (including checked rows), and immediate feedback. It
  treats text as an item name, as the current quick-add control does.
- Weekly shopping includes all recipes in the displayed week, including cooked
  recipes. Completion appears only after all visible shopping rows are checked,
  clears the list, and offers a local Undo.

## Deliberate mockup simplifications

- The date is frozen at September 30, 2026, matching the evaluation session;
  fixture week is September 28–October 4. No account configuration is loaded.
- The current checked-in Planner adds recipes directly to Shopping; it has no
  selection dialog. This mockup adds the requested recipe/ingredient/servings
  chooser as a design proposal, then uses the real contribution reducer.
  Unchecking an ingredient replaces that recipe's contribution on re-add.
- Swap uses an explicit fixture recipe picker instead of live randomized
  category/history selection. Move is limited to the displayed week, matching
  the current card's day menu. Fixture recipe details have short representative
  instructions; two original Stitch images are local assets.
- No live Pantry/exclusion configuration, plan generation, Quick Meal Mix,
  template management, authentication, persistence, concurrency, or network
  retry machinery is mounted. Failure Retry returns to populated fixtures;
  Loading stays visible until another scenario is chosen.
- Completion Undo restores an in-memory snapshot and is cleared by a subsequent
  shopping mutation. Planner removal has immediate feedback, without the full
  app's timed Undo toast.

## Verification

Run from `web/` while the server is available:

```powershell
node node_modules/typescript/bin/tsc -p mockup/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js mockup/app/page.tsx mockup/app/layout.tsx mockup/fixtures.ts
node mockup/verify.cjs
node mockup/inspect.cjs
node node_modules/vitest/vitest.mjs run src/lib/__tests__/shopping-document.test.ts src/components/planner/tests/meal-planner.utils.test.ts
```

Verified Chromium at 1440×900 and WebKit with touch at 390×844: no horizontal
overflow, correct mobile section order, scrolling, multiple meals, menus and
keyboard focus return, recipe view/picker, swap, move, remove, cooked restrictions,
weekly inclusion, shopping selection, re-addition, quick add duplicates,
checkbox updates, completion, all seven scenarios, and Retry. No page errors or
external requests occurred. Axe scans of dashboard and shopping dialog passed
in both browsers. Completion Undo passed in both. The two existing focused
unit suites passed: 42 tests.

Screenshots are ignored local artifacts in `verification/`. No commit, push,
merge, deployment, schema change, or production/account write was performed.
