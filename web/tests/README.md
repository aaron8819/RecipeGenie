# Recipe Genie E2E Tests

> **When to read:** You're writing, debugging, or modifying E2E tests, or setting up Playwright fixtures and auth.

*Last updated: 2026-02-26 (v2.15.0)*

Comprehensive Playwright test suite for Recipe Genie, covering authentication, navigation, recipes, meal planning, shopping lists, pantry management, responsive design, accessibility, and visual design.

## Prerequisites

1. **Install Playwright browsers:**
   ```bash
   npx playwright install
   ```

2. **Ensure the dev server is running (or let Playwright start it):**
   ```bash
   npm run dev
   ```

## Authentication Setup

Tests run with an authenticated user by default. The global setup (`global-setup.ts`) logs in once and saves the session state to `playwright/.auth/user.json`. All tests then reuse this session.

**Test user credentials are configured in:**
- `tests/fixtures.ts` - `TEST_USER` constant
- `tests/global-setup.ts` - Used for initial authentication

**To change test user:**
1. Update `TEST_USER` in `fixtures.ts`
2. Update credentials in `global-setup.ts`

**For tests that need unauthenticated state** (e.g., testing login form):
```typescript
test.describe('My unauthenticated tests', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  // ... tests here will see the login page
})
```

## Running Tests

### Run all tests
```bash
npm run test:e2e
```

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
npm run test:e2e:full
```

### `test.skip` Policy
Use `test.skip` only with an inline ticket token (for example: `test.skip(/* ISSUE-123 */)`).
CI runs `npm run check:no-new-test-skip` and fails on any `test.skip` without an `ISSUE-` token unless it is in the temporary legacy allowlist.

### Run tests with UI mode (recommended for development)
```bash
npm run test:e2e:ui
```

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
| `authentication.spec.ts` | Sign up, sign in, sign out, guest mode, session persistence |
| `navigation.spec.ts` | Desktop header, mobile bottom nav, tab switching, active indicators |
| `recipes.spec.ts` | Recipe CRUD, add/edit modals, import from text, category management |
| `meal-planner.spec.ts` | Plan generation, settings modal, day assignments, mark as made |
| `shopping-list.spec.ts` | List generation, check off items, auto-collapse, add to pantry |
| `shopping-list-mobile.spec.ts` | Mobile-specific shopping list flows (viewport 375px) |
| `pantry.spec.ts` | Add/delete items, excluded keywords, clear all |
| `responsive.spec.ts` | Mobile (375px, 390px, 414px), tablet (768px), desktop (1024px, 1440px) |
| `accessibility.spec.ts` | WCAG 2.1 AA, axe-core checks, keyboard nav, focus indicators |
| `visual-design.spec.ts` | Stitch theme, fonts, colors, border radius, made recipe styling |

## Test Fixtures

The `fixtures.ts` file provides reusable helpers:

- `setupAuth()` - Navigate to app with authenticated session (uses global setup)
- `enterGuestMode()` - Enter guest mode from auth screen (clears session first)
- `signIn(email?, password?)` - Sign in with credentials
- `signOut()` - Sign out of current session
- `navigateToTab(tab)` - Navigate to planner/recipes/shopping/pantry
- `addRecipe(recipe)` - Add a recipe via UI
- `waitForAppLoad()` - Wait for app to be fully loaded
- `getActiveTab()` - Get name of active tab
- `isMobileViewport()` - Check if on mobile viewport

### Authenticated vs Guest Testing

Most tests use `setupAuth()` which reuses the authenticated session from global setup:
```typescript
test('my authenticated test', async ({ page, setupAuth }) => {
  await setupAuth()  // Already logged in
  // ... test authenticated features
})
```

For guest mode testing, use `enterGuestMode()`:
```typescript
test('my guest test', async ({ page, enterGuestMode }) => {
  await enterGuestMode()  // Clears session, enters guest mode
  // ... test guest features
})
```

### Sample Data

```typescript
import { SAMPLE_RECIPE, SAMPLE_RECIPE_TEXT, TEST_USER, VIEWPORTS } from './fixtures'

// Use sample recipe for tests
await addRecipe(SAMPLE_RECIPE)

// Import recipe from text
await pasteArea.fill(SAMPLE_RECIPE_TEXT)

// Set viewport
await page.setViewportSize(VIEWPORTS.mobile)
```

## Viewport Configurations

| Name | Width | Height |
|------|-------|--------|
| `mobileSmall` | 320 | 568 |
| `mobile` | 375 | 812 |
| `mobileLarge` | 414 | 896 |
| `tablet` | 768 | 1024 |
| `desktop` | 1024 | 768 |
| `desktopLarge` | 1440 | 900 |

## CI Integration

The Playwright config is CI-ready:
- Automatically starts dev server
- Takes screenshots on failure
- Generates HTML report
- Retries failed tests on CI

### GitHub Actions Example
```yaml
- name: Run E2E Tests
  run: npm run test:e2e:smoke

- name: Run full E2E matrix
  run: npm run test:e2e:full
  env:
    CI: true
```

## Best Practices

1. **Use data-testid for stable selectors** when needed
2. **Wait for elements** using Playwright's auto-waiting
3. **Use descriptive test names** that explain the expected behavior
4. **Group related tests** with `describe` blocks
5. **Test both guest and authenticated flows** where relevant
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
  test.beforeEach(async ({ page, enterGuestMode }) => {
    await enterGuestMode()
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
