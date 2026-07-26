# Recipe Genie E2E Tests

> **When to read:** You're writing, debugging, or modifying E2E tests, or setting up Playwright fixtures and auth.

*Last updated: 2026-07-26*

This is the authoritative Playwright guide for Recipe Genie: commands, target
guards, fixtures, and authentication-state lifecycle.

## Prerequisites

1. **Install Playwright browsers:**
   ```bash
   npx playwright install
   ```

2. **Prepare an approved target:** for normal authenticated development, use
   the guarded local bootstrap below. Playwright starts the configured web
   server for project commands; do not substitute a production target.

## Authentication Setup

Tests run with an authenticated user by default. Credentials come only from
the ignored `.env.e2e.local` file or an approved CI secret store. The current
contract uses `RECIPE_GENIE_E2E_*`, `NEXT_PUBLIC_SUPABASE_URL`, and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. The fixture signs in through an artifact-free
context, creates per-test runtime state under ignored `.playwright/auth/`, and
deletes it after use. See
[E2E_CREDENTIALS.md](./E2E_CREDENTIALS.md) for the complete target and
credential contract.

For the complete local Supabase bootstrap, deterministic fixture, worktree,
manual browser, and inspection workflow, see
[LOCAL_AUTH_BROWSER.md](./LOCAL_AUTH_BROWSER.md).

**For tests that need unauthenticated state** (e.g., testing login form):
```typescript
test.describe('My unauthenticated tests', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  // ... tests here will see the login page
})
```

## Running Tests

### Run the core CI project
```bash
npm run test:e2e:core
```

This is the canonical core CI command; it is not the full browser matrix.

### Run smoke tests (critical flow, Chromium-only)
```bash
npm run test:e2e:smoke
```

Smoke tests are selected by explicit `@smoke` tags in test titles.

### Validate smoke selection (tripwire)
```bash
npm run test:e2e:smoke:list
```

This command lists smoke tests and fails if fewer than 5 are selected.

### Run full cross-browser matrix
```bash
npm run test:e2e:matrix
```

### `test.skip` Policy
Use `test.skip` only with an inline ticket token (for example: `test.skip(/* ISSUE-123 */)`).
CI runs `npm run check:no-new-test-skip` and fails on any `test.skip` without an `ISSUE-` token unless it is in the temporary legacy allowlist.

### Run tests with UI mode (recommended for development)
```bash
npm run test:e2e:ui
```

### Run the authenticated local inspection harness

```bash
npm run local:e2e:bootstrap
npm run test:e2e:inspect
```

The bootstrap is loopback-only. It verifies the runtime and Docker, starts or
resets local Supabase, applies every tracked migration, recreates the synthetic
local user and fixtures, verifies sign-in, and writes the current worktree's
ignored `.env.e2e.local`. It has no linked or remote fallback. Use
`npm run local:e2e:reset` to restore fixtures and
`npm run local:e2e:status` for a non-secret readiness check.

### Verify the full recipe import workflow

```bash
npm run verify:recipe-import
```

Use this explicit higher-confidence command for recipe parser, import dialog,
recipe persistence, or replacement-flow changes. It drives the actual desktop
UI through two loopback-only authenticated scenarios:

- create Sesame Chicken from the canonical Markdown fixture, review the parsed
  warning and preview, save, refresh/reopen, and assert stored recipe structure;
- seed a deterministic recipe through an authenticated local client, replace it
  through the current edit/import UI, refresh/reopen, and assert both replaced
  content and preserved identity/metadata.

The verifier confirms the Recipe Genie worktree identity, rejects inherited
shared or production-like Supabase configuration, reuses running local
Supabase, and generates or refreshes the current worktree's ignored
`.env.e2e.local` when that can be done without changing data. If local Supabase
is unavailable, it starts or initializes the loopback-only services without a
reset and reports that a new local volume may apply tracked migrations. It
never runs `supabase db reset --local`, applies a linked migration, or uses a
remote fallback.

The browser scenarios create only disposable rows owned by the dedicated local
E2E user and remove them after each scenario. A missing or invalid local auth
fixture produces one explicit action to authorize and run
`npm run local:e2e:bootstrap`; the verifier does not cross that destructive
reset boundary itself. Cleanup failures fail the command.

Failure screenshots, video, trace, diagnostics, and the HTML report remain in
the ignored `test-results/` and `playwright-report/` paths. The console summary
reports browser console errors/warnings, page errors, failed requests, 5xx
responses, external runtime targets, scenario assertions, and cleanup.

Keep `npm run verify` as the fast local quality baseline. Parser unit tests
prove deterministic parsing rules; `verify:recipe-import` separately proves
the browser dialog, authenticated application mutations, stored local data,
replacement preservation, and reopen behavior.

### Run tests in headed mode (see browser)
```bash
npm run test:e2e:headed
```

### Run tests in debug mode
```bash
npm run test:e2e:debug
```

### Run specific test file
```bash
npx playwright test authentication.spec.ts
npx playwright test recipes.spec.ts
npx playwright test responsive.spec.ts
```

### Run tests for specific browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project="Mobile Chrome"
```

### View test report
```bash
npm run test:e2e:report
```

### Generate tests with codegen
```bash
npm run test:e2e:codegen
```

## Test Files

| File | Coverage |
|------|----------|
| `authentication.spec.ts` | Sign up, sign in, sign out, session persistence |
| `navigation.spec.ts` | Desktop header, mobile bottom nav, tab switching, active indicators |
| `recipes.spec.ts` | Recipe CRUD, add/edit modals, import from text, category management |
| `meal-planner.spec.ts` | Plan generation, settings modal, day assignments, mark as made |
| `shopping-list.spec.ts` | List generation, check off items, auto-collapse, add to pantry |
| `shopping-list-mobile.spec.ts` | Mobile-specific shopping list flows (viewport 375px) |
| `pantry.spec.ts` | Add/delete items, excluded keywords, clear all |
| `responsive.spec.ts` | Mobile (375px, 390px, 414px), tablet (768px), desktop (1024px, 1440px) |
| `accessibility.spec.ts` | WCAG 2.1 AA, axe-core checks, keyboard nav, focus indicators |
| `recipe-sharing-authorization.spec.ts` | Share authorization and cross-user access boundaries |
| `smoke-critical-flow.spec.ts` | Explicitly tagged critical-path smoke coverage |
| `shopping-mode-smoke.spec.ts` | Focused shopping-mode smoke coverage |
| `local-browser-inspection.spec.ts` | Guarded local authenticated viewport and diagnostics inspection |
| `mobile-import-review.spec.ts` | Mobile import review and recipe-dialog reliability |
| `recipe-import-browser.spec.ts` | Canonical Markdown create/replace persistence and preservation |

## Test Fixtures

The `fixtures.ts` file provides reusable helpers:

- `setupAuth()` - Navigate to the app with isolated per-test authentication state
- `signOut()` - Sign out of current session
- `navigateToTab(tab)` - Navigate to planner/recipes/shopping/pantry
- `addRecipe(recipe)` - Add a recipe via UI
- `waitForAppLoad()` - Wait for app to be fully loaded
- `getActiveTab()` - Get name of active tab
- `isMobileViewport()` - Check if on mobile viewport

### Authenticated Testing

Most tests use `setupAuth()` after the fixture creates a fresh authenticated session:
```typescript
test('my authenticated test', async ({ page, setupAuth }) => {
  await setupAuth()
  // ... test authenticated features
})
```

### Sample Data

```typescript
import { SAMPLE_RECIPE, TEST_USER, VIEWPORTS } from './fixtures'

// Use sample recipe for tests
await addRecipe(SAMPLE_RECIPE)

// Set viewport
await page.setViewportSize(VIEWPORTS.mobile)
```

## Viewport Configurations

| Name | Width | Height |
|------|-------|--------|
| local inspection small | 360 | 780 |
| local inspection standard | 390 | 844 |
| local inspection large | 430 | 900 |
| `tablet` | 768 | 1024 |
| local inspection desktop | 1200 | 800 |
| `desktopLarge` | 1440 | 900 |

## CI Integration

The Playwright config is CI-ready:
- Automatically starts dev server
- Takes screenshots on failure
- Generates HTML report
- Retries failed tests on CI

E2E is not enabled in GitHub Actions. Do not add it until an approved account, deterministic target, and the documented secret variables are configured. Production must never be the default target.

## Best Practices

1. **Use data-testid for stable selectors** when needed
2. **Wait for elements** using Playwright's auto-waiting
3. **Use descriptive test names** that explain the expected behavior
4. **Group related tests** with `describe` blocks
5. **Test authenticated and unauthenticated flows** where relevant
6. **Test all major viewports** for responsive features
7. **Check accessibility** with axe-core

## Debugging Tips

1. **Use UI mode** to step through tests visually
2. **Use `page.pause()`** to pause execution and inspect
3. **Check screenshots** in `test-results/` on failure
4. **Use trace viewer** for detailed debugging:
   ```bash
   npx playwright show-trace trace.zip
   ```

## Adding New Tests

1. Create a new `.spec.ts` file in `tests/`
2. Import fixtures: `import { test, expect } from './fixtures'`
3. Use `test.describe()` for grouping
4. Use `test.beforeEach()` for setup
5. Follow existing patterns for consistency

### Example Test
```typescript
import { test, expect, VIEWPORTS } from './fixtures'

test.describe('My Feature', () => {
  test.beforeEach(async ({ setupAuth }) => {
    await setupAuth()
  })

  test('should do something', async ({ page }) => {
    await page.getByRole('button', { name: /my button/i }).click()
    await expect(page.getByText('Success')).toBeVisible()
  })
})
```

## Troubleshooting

### Tests timing out
- Increase timeout in `playwright.config.ts`
- Check if dev server is running
- Verify network conditions

### Flaky tests
- Add proper wait strategies
- Use `waitForLoadState('networkidle')`
- Avoid hardcoded timeouts where possible

### Element not found
- Check if element is in viewport
- Verify selectors are correct
- Consider using more specific locators
