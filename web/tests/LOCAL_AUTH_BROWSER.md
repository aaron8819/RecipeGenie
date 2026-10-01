# Local authenticated browser testing

Use this workflow for normal authenticated development and exhaustive browser
inspection. It is local-only: Docker hosts Supabase, Recipe Genie runs on
`127.0.0.1:3107`, and all fixture mutations stay on the machine.

## Optimized production-build inspection

For an authorized disposable backend, build with its loopback
`NEXT_PUBLIC_SUPABASE_URL` and anon key. Use the pinned Node/npm runtime.
Set `RECIPE_GENIE_E2E_TARGET=local` and `RECIPE_GENIE_LOCAL_CSP_ORIGIN` to that
exact backend origin including port, in the ignored `.env.local` or process
environment. Wait for the build to succeed, then start these two processes
from `web/` in separate terminals:

```powershell
npm run build
npm start -- --hostname 127.0.0.1 --port 3118
npm run local:production -- --port 3117 --upstream-port 3118
```

Browse port 3117. The separate verification ingress binds only to `127.0.0.1`
(or `--hostname ::1`) and forwards only to `127.0.0.1` on the selected upstream
port. It is a local HTTP verification tool, not a deployment server or a forward
proxy. Stop both processes after inspection. It requires the existing `tsx`
dev dependency; there is no custom Next server or production dependency.

The ingress examines Node's `IncomingMessage.rawHeaders` before forwarding.
Exactly one Host field is required; missing or duplicate Host fields (even
identical values or different casing) are rejected. Header-count truncation is
disabled while Node's header byte limit remains enforced. A validated loopback
Host, exact explicit backend opt-in and absent `VERCEL` are required to append
the origin to the upstream's known production `connect-src` directive. Client
validation markers are ignored. All ingress responses use private, no-store.
The original status, nonce, cookies and unrelated security headers are retained.

Host accepts case-insensitive `localhost`, strict dotted-decimal IPv4 in 127/8,
and bracketed IPv6 loopback (compressed or expanded), optionally with a decimal
port from 1 to 65535. Abbreviated/numeric IPv4, leading-zero octets or ports,
trailing dots, userinfo, lists, paths and zone identifiers do not qualify.
`Forwarded` disqualifies the allowance; `X-Forwarded-Host` must be absent or
occur exactly once and match Host case-insensitively. Neither establishes
trust. The backend origin must be HTTP localhost, 127.0.0.1 or [::1] with an
explicit port, no path/query/credentials, and match the public Supabase URL.

Supported launch paths:

- `npm start` / direct `next start`: always restrictive production CSP, even
  with the local opt-in or forged validation headers. Direct access to the
  upstream cannot obtain the allowance. Hosted production uses this policy.
- `npm run local:production` in front of an optimized `next start`: the only
  supported production-build local CSP allowance, enforced at raw ingress.
  Default, disabled, inconsistent and hosted/VERCEL settings stay restrictive.
- `npm run dev` / `npm run local:e2e:dev`: existing development/HMR policy;
  these are not production-build verification or deployment paths.

Do not deploy the local ingress or set the opt-in in hosted configuration.
`npm run test:csp:server` exercises the built server and ingress with raw TCP
requests, including duplicates, direct-upstream bypass attempts, redirects and
errors. A passing build alone is not authenticated browser evidence. The
Shopping slice scripts use backend `http://127.0.0.1:57321` and ingress 3117.

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

For the focused full recipe-import persistence workflow, run:

```powershell
npm run verify:recipe-import
```

Unlike `local:e2e:bootstrap`, this command does not reset the database or
recreate the local user. It can generate the current worktree's ignored config,
start or initialize loopback-local services, and reuse a valid local auth
fixture. It reports that a new local volume may apply tracked migrations.
The browser scenarios own and clean their disposable recipe rows. If the local
user fixture is missing, the command stops and reports that an explicitly
authorized `npm run local:e2e:bootstrap` reset is required.

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
