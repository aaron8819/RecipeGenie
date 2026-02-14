# Technical Debt Cleanup Plan

**Status:** Draft
**Created:** 2026-02-14
**For:** Recipe Genie v2.15.0+
**Goal:** Address accumulated technical debt now that the app is stable with production users

---

## Executive Summary

Recipe Genie is in a healthy state with minimal critical technical debt. The app has:
- ✅ Clean linting (0 warnings/errors)
- ✅ Strict TypeScript enabled
- ✅ No TODO/FIXME comments
- ✅ Minimal console statements
- ✅ Strong test coverage for business logic (lib/)

However, there are opportunities to improve:
- 📊 Test coverage (especially components and hooks)
- 🔧 Tooling configuration (Next.js lint deprecation, lockfile warnings)
- 🗂️ File organization (migration files, test artifacts)
- 📦 Dependency management (unused deps, prepare for Next.js 16)

---

## Priority Levels

**P0** - Critical, blocks future work or creates risks
**P1** - High value, noticeable improvement
**P2** - Medium value, quality of life
**P3** - Low value, nice to have

---

## P0: Critical Items

### 1. Next.js Lint Migration (P0)

**Problem:**
```
`next lint` is deprecated and will be removed in Next.js 16.
For existing projects, migrate to the ESLint CLI:
npx @next/codemod@canary next-lint-to-eslint-cli .
```

**Impact:** Blocking - will break on Next.js 16 upgrade
**Effort:** Low (~30 minutes)

**Tasks:**
1. Run the official codemod: `npx @next/codemod@canary next-lint-to-eslint-cli .`
2. Verify linting still works: `npm run lint`
3. Update package.json scripts
4. Test in CI/CD if applicable
5. Commit changes

---

### 2. Workspace Root Configuration (P0)

**Problem:**
```
⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
We detected multiple lockfiles and selected the directory of C:\Users\aabloch\package-lock.json as the root directory.
```

**Impact:** Build warnings, potential caching issues
**Effort:** Low (~15 minutes)

**Tasks:**
1. Add `outputFileTracingRoot` to `next.config.js`
2. Or remove extraneous lockfile at `C:\Users\aabloch\package-lock.json`
3. Verify build warnings are resolved
4. Document decision in `decisions.md`

---

### 3. Missing ESLint Plugin Dependency (P0)

**Problem:** `@typescript-eslint/eslint-plugin` referenced in `.eslintrc.json` but not in package.json

**Impact:** ESLint may not work correctly for future contributors
**Effort:** Low (~5 minutes)

**Tasks:**
1. Add to devDependencies: `npm install -D @typescript-eslint/eslint-plugin`
2. Verify ESLint still runs correctly
3. Update lockfile

---

## P1: High-Value Improvements

### 4. Component Test Coverage (P1)

**Current State:**
- 44 component files
- 0 component test files (`.test.tsx`)
- Only E2E tests via Playwright

**Recommendation:** Add unit tests for critical components

**Suggested Components to Test (priority order):**
1. `recipe-dialog.tsx` - Complex form logic, validation, tabs
2. `meal-planner.tsx` - Day assignments, drag-and-drop, state management
3. `shopping-list.tsx` - Item management, merging logic UI
4. `recipe-card.tsx` - Conditional rendering, actions
5. `multi-select.tsx` - Custom UI component, keyboard navigation
6. `tag-input.tsx` - Input handling, validation

**Effort:** Medium (~2-3 hours per component)
**Impact:** Catch regressions during refactoring, faster iteration

**Tasks:**
1. Set up component testing utilities (React Testing Library)
2. Write tests for top 3 critical components
3. Add component test coverage to CI
4. Document component testing patterns

---

### 5. Hook Test Coverage (P1)

**Current State:**
- 22 hook files
- 2 test files (`use-recipes.test.ts`, `shopping-list-checked-state.test.ts`)
- ~9% hook test coverage

**Recommendation:** Test critical hooks with complex logic

**Suggested Hooks to Test (priority order):**
1. `use-planner.ts` - Meal plan generation, day assignments
2. `use-shopping-list.ts` - Shopping list generation, merging
3. `use-recipes.ts` - CRUD operations, optimistic updates
4. `use-pantry.ts` - Pantry management, keyword matching
5. `use-recipe-import.ts` - URL parsing, recipe extraction

**Effort:** Medium (~1-2 hours per hook)
**Impact:** Confidence in refactoring, catch edge cases

**Tasks:**
1. Add tests for top 3 critical hooks
2. Mock Supabase client properly
3. Test optimistic update rollback scenarios
4. Document hook testing patterns

---

### 6. API Route Test Coverage (P1)

**Current State:**
- 6 API routes
- 0 API route tests

**Routes:**
- `/api/recipe-shares` (POST)
- `/api/recipe-shares/inbox` (GET)
- `/api/recipe-shares/sent` (GET)
- `/api/recipe-shares/[id]/accept` (POST)
- `/api/recipe-shares/[id]/decline` (POST)
- `/api/recipe-import` (POST)

**Effort:** Medium (~1 hour per route)
**Impact:** Prevent API regressions, validate auth/RLS

**Tasks:**
1. Set up API testing utilities (mock Supabase, auth)
2. Test happy paths and error cases
3. Test auth requirements (unauthenticated requests fail)
4. Test rate limiting (recipe-import)
5. Document API testing patterns

---

### 7. Gitignore Test Artifacts (P1)

**Problem:** `test-results/` directory contains 100+ error-context.md files

**Impact:** Noise in git status, accidental commits
**Effort:** Low (~5 minutes)

**Tasks:**
1. Verify `test-results/` is in `.gitignore` (already should be)
2. Delete local `test-results/` directory: `rm -rf web/test-results`
3. Verify Playwright still generates reports correctly
4. Add `playwright-report/` to `.gitignore` if not already

---

## P2: Medium-Value Improvements

### 8. Migration File Organization (P2)

**Problem:** Data fix migrations mixed with schema migrations in `supabase/migrations/`

**Files:**
- `check-user-recipes.sql` - Data inspection query
- `migrate-bad-recipe-id.sql` - One-time data fix

**Recommendation:** Move to `supabase/migrations/archive/` or `supabase/scripts/`

**Effort:** Low (~10 minutes)
**Impact:** Cleaner migration folder, easier to understand schema evolution

**Tasks:**
1. Create `supabase/migrations/archive/` folder
2. Move data fix migrations to archive
3. Update `supabase/SCHEMA.md` with notes on migration history
4. Document when to use migrations vs scripts

---

### 9. Dependency Audit (P2)

**Findings from `depcheck`:**
- `@radix-ui/react-toast` flagged as unused (FALSE POSITIVE - used in `undo-toast.tsx`)

**Recommendation:** Audit all dependencies for actual usage

**Effort:** Low (~30 minutes)
**Impact:** Smaller bundle size, cleaner package.json

**Tasks:**
1. Run `npm ls @radix-ui/react-toast` to verify usage
2. Check if any other Radix components are truly unused
3. Run `npm outdated` to check for updates
4. Consider minor version updates for Radix UI components
5. Document any intentionally kept but unused deps

---

### 10. Prepare for Next.js 16 (P2)

**Context:** Currently on Next.js 15.5.12 (React 18.2.0)

**Next.js 16 Changes (likely):**
- React 19 support (optional upgrade)
- ESLint migration (covered in P0)
- Possible Turbopack defaults
- Enhanced App Router features

**Effort:** Medium (~1-2 hours)
**Impact:** Stay current, avoid breaking changes

**Tasks:**
1. Monitor Next.js 16 release notes
2. Review Next.js 16 migration guide when released
3. Test build on Next.js 16 canary
4. Decide on React 19 upgrade path (separate ADR)
5. Update CLAUDE.md with Next.js 16 migration notes

---

### 11. TypeScript Strict Mode Enhancements (P2)

**Current State:** Strict mode enabled ✅

**Potential Improvements:**
- Enable `noUncheckedIndexedAccess` (safer array access)
- Enable `noPropertyAccessFromIndexSignature` (safer object access)
- Review `@ts-expect-error` comments (Supabase workarounds)

**Effort:** Low-Medium (~1 hour)
**Impact:** Catch more runtime errors at compile time

**Tasks:**
1. Try enabling `noUncheckedIndexedAccess` in `tsconfig.json`
2. Fix compilation errors (add null checks)
3. Evaluate value vs effort
4. If beneficial, add to CLAUDE.md standards
5. If too noisy, document decision in ADR

---

### 12. Consolidate Barrel Exports (P2)

**Current State:** Shopping hooks use barrel export (`hooks/shopping/index.ts`)

**Opportunity:** Apply pattern to other hook groups

**Potential Candidates:**
- `hooks/` - Create `hooks/index.ts` for all hooks
- `lib/` - Create domain-specific barrels (e.g., `lib/planner/index.ts`)

**Effort:** Low (~30 minutes)
**Impact:** Cleaner imports, better code organization

**Tasks:**
1. Evaluate if barrel exports improve or hurt tree-shaking
2. If beneficial, create barrels for logical groups
3. Update import statements across codebase
4. Document barrel export patterns in CLAUDE.md

---

## P3: Nice-to-Have

### 13. Document Component Props (P3)

**Current State:** Most components have implicit prop types

**Recommendation:** Add JSDoc comments to component props

**Example:**
```tsx
interface RecipeCardProps {
  /** The recipe to display */
  recipe: Recipe;
  /** Whether to show the favorite button */
  showFavorite?: boolean;
  /** Callback when recipe is clicked */
  onClick?: (recipe: Recipe) => void;
}
```

**Effort:** High (~5 minutes per component, 44 components = 3-4 hours)
**Impact:** Better IDE tooltips, easier onboarding

---

### 14. Playwright Test Organization (P3)

**Current State:** All E2E tests in `web/tests/*.spec.ts`

**Recommendation:** Group tests by feature area

**Proposed Structure:**
```
web/tests/
├── auth/
│   ├── login.spec.ts
│   └── signup.spec.ts
├── recipes/
│   ├── crud.spec.ts
│   ├── sharing.spec.ts
│   └── import.spec.ts
├── planner/
│   └── meal-planning.spec.ts
└── shopping/
    └── shopping-list.spec.ts
```

**Effort:** Low (~30 minutes)
**Impact:** Easier to find and run specific test groups

---

### 15. Storybook for Component Library (P3)

**Opportunity:** Add Storybook for UI component development

**Benefits:**
- Visual component testing
- Isolated development environment
- Living documentation

**Effort:** High (~4-6 hours setup + ongoing maintenance)
**Impact:** Faster UI development, better component reuse

**Tasks:**
1. Evaluate if Storybook adds value for this project
2. If yes, set up Storybook with Tailwind
3. Add stories for `ui/` components first
4. Add stories for domain components (recipes, planner)
5. Document Storybook workflow in CLAUDE.md

---

## Suggested Execution Plan

### Phase 1: Foundation (Week 1)
**Goal:** Fix blocking issues and tooling

- [ ] P0-1: Migrate ESLint to CLI
- [ ] P0-2: Fix workspace root warning
- [ ] P0-3: Add missing ESLint plugin
- [ ] P1-7: Gitignore test artifacts
- [ ] P2-8: Organize migration files

**Estimated Time:** 2-3 hours

---

### Phase 2: Testing Infrastructure (Week 2-3)
**Goal:** Establish testing patterns and coverage

- [ ] P1-4: Component tests (top 3 components)
- [ ] P1-5: Hook tests (top 3 hooks)
- [ ] P1-6: API route tests (all 6 routes)

**Estimated Time:** 8-12 hours

---

### Phase 3: Quality & Maintenance (Week 4)
**Goal:** Improve code quality and prepare for future

- [ ] P2-9: Dependency audit
- [ ] P2-10: Prepare for Next.js 16
- [ ] P2-11: TypeScript strict mode enhancements
- [ ] P2-12: Consolidate barrel exports (if valuable)

**Estimated Time:** 4-6 hours

---

### Phase 4: Optional Enhancements (Backlog)
**Goal:** Nice-to-have improvements as time permits

- [ ] P3-13: Document component props
- [ ] P3-14: Reorganize Playwright tests
- [ ] P3-15: Evaluate Storybook

**Estimated Time:** 8-12 hours

---

## Success Metrics

**Before Cleanup:**
- 19 test files for 105 source files (18% coverage)
- 0 component tests
- 2 hook tests
- 0 API tests
- 2 ESLint warnings (deprecation, workspace root)

**After Phase 1-2 (Minimum):**
- ~30 test files (component + hook + API)
- 3 component tests
- 5 hook tests
- 6 API tests
- 0 ESLint warnings

**After Phase 3 (Target):**
- ~35 test files
- 6 component tests
- 8 hook tests
- 6 API tests
- 0 ESLint warnings
- Next.js 16 ready
- Clean dependency tree

---

## Non-Goals

**Explicitly NOT included in this cleanup:**

1. **Feature work** - No new features, only refactoring
2. **Breaking changes** - Maintain backward compatibility
3. **Database migrations** - Schema is stable, no changes needed
4. **UI redesign** - Design system is solid (v2.11.0)
5. **Performance optimization** - App is fast, no perf issues
6. **React 19 upgrade** - Separate decision, wait for Next.js 16
7. **100% test coverage** - Diminishing returns, focus on critical paths

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Breaking changes during refactoring | Medium | High | Run E2E tests after each phase |
| Test flakiness | Medium | Medium | Use deterministic test data, mock time |
| Time overruns | High | Low | Prioritize P0/P1, defer P3 |
| Next.js 16 breaking changes | Low | Medium | Monitor release notes, test canary |
| Merge conflicts (if team grows) | Low | Low | Small, focused PRs |

---

## Rollout Strategy

1. **Create feature branch:** `feat/technical-debt-cleanup`
2. **Execute phases incrementally:** 1 PR per phase
3. **Run full test suite:** After each PR
4. **Manual QA:** Smoke test all features after Phase 2
5. **Merge to main:** After all tests pass
6. **Deploy to staging:** Verify in production-like environment
7. **Deploy to production:** After 24-48 hour soak in staging

---

## Questions for Discussion

1. **Phase execution:** Should we do all phases, or stop after Phase 2?
2. **Component test tooling:** React Testing Library or Vitest browser mode?
3. **API test strategy:** Integration tests or unit tests with mocked Supabase?
4. **Next.js 16 timing:** Wait for stable release or test canary now?
5. **Storybook:** Worth the investment for this project size?
6. **Test coverage target:** Aim for 80% or focus on critical paths?

---

## Next Steps

1. **Review this plan** - Discuss priorities and scope
2. **Approve phases** - Decide which phases to execute
3. **Create issues** - Break down into trackable work items
4. **Start Phase 1** - Fix critical tooling issues
5. **Iterate** - Adjust plan based on learnings

---

**Document Owner:** Engineering Team
**Last Updated:** 2026-02-14
**Next Review:** After Phase 2 completion
