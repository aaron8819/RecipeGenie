# Local authenticated browser testing

Use this workflow for normal authenticated development and exhaustive browser
inspection. It is local-only: Docker hosts Supabase, Recipe Genie runs on
`127.0.0.1:3107`, and all fixture mutations stay on the machine.

## Prerequisites

- Node 22 and npm 10
- Docker Desktop running
- `npm ci` completed in the worktree's `web/` directory
- Playwright Chromium installed (`npx playwright install chromium`)
- One ignored `web/.env.e2e.local` in any Recipe Genie worktree containing the
  documented local target, email, and password values

The bootstrap locates that ignored credential file across registered Git
worktrees and writes a minimal local-only copy into the current worktree. It
does not copy `.env.local`, production credentials, or service-role values.
Local Supabase keys are read from `supabase status` and are never printed.

## Initial setup and daily use

From `web/`:

```powershell
npm run local:e2e:bootstrap
npm run test:e2e:inspect:headed
```

`local:e2e:bootstrap` verifies Node, Docker, the pinned Supabase CLI, and the
exact loopback target; starts Supabase if needed; resets the local database;
applies migrations; recreates the local auth user; seeds fixtures; verifies a
real sign-in; and writes ignored local configuration.

For manual inspection, start the guarded development server and open
`http://127.0.0.1:3107`:

```powershell
npm run local:e2e:dev
```

Sign in with the machine-local credentials from `web/.env.e2e.local`. Never
paste them into a guessed or remote URL.

## Reset and authenticated Playwright

Restore the known fixture state after exploratory mutations:

```powershell
npm run local:e2e:reset
```

Run the focused headless inspection (suitable for Codex) or the headed version:

```powershell
npm run test:e2e:inspect
npm run test:e2e:inspect:headed
```

Playwright signs in through a fresh artifact-free context for every test,
writes storage state only under ignored `.playwright/auth/`, binds it to the
approved local origin, and removes it after the test. Inspection artifacts
include viewport metrics, screenshots, console/page/network diagnostics,
horizontal overflow, scroll-screen count, visible actions, and a 390x420
focused-input scenario. The covered widths are 360, 390, 430, and 1200 pixels.

## Fixture state

The bootstrap recreates one dedicated local auth user and seeds only synthetic
data:

- eight recipes, including a long-form recipe and dense mobile card set;
- active and completed shopping items across multiple categories, plus
  already-have and excluded buckets;
- an intentionally empty custom shopping category;
- a partially assigned current planner week;
- pantry items and an excluded ingredient keyword.

The data never comes from production. User deletion, database reset, and seed
operations are allowed only after the exact `http://127.0.0.1:54321` Supabase
origin is established.

## Safety and troubleshooting

- `npm run local:e2e:status` checks local readiness without printing keys.
- Local commands reject non-loopback, alternate-port, credential-bearing, and
  production-project URLs before any fixture mutation.
- Reset uses `supabase db reset --local`; there is no linked or remote fallback.
- `.env.e2e.local`, auth state, reports, traces, and screenshots are ignored.
- If Docker is unavailable, start Docker Desktop. Do not substitute a shared
  Supabase project.
- If no local credential source exists, create the ignored file described in
  [E2E_CREDENTIALS.md](./E2E_CREDENTIALS.md) in one worktree, then rerun
  bootstrap. This is the only unavoidable machine-local setup.

## Local versus production policy

Use local Supabase for normal development, destructive paths, fixture-heavy
flows, layout inspection, and all exhaustive Playwright work. The production
test account is secondary and may be used only after deployment for narrow,
explicitly authorized smoke checks. Its reads are isolated by RLS, but common
UI flows mutate its recipes, planner, pantry, configuration, and shopping
state; cleanup is not reliable enough for general testing. Production login
requires separate machine-local credentials, the exact verified production
alias, and `RECIPE_GENIE_E2E_ALLOW_PRODUCTION=true`. Never reuse local storage
state against production and never make production the fallback target.
