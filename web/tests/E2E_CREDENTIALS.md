# Playwright credential setup

Playwright credentials are Node-side test inputs. Never use `NEXT_PUBLIC_*` variables for them and never paste them into a domain discovered by guessing a project URL.

Store local values in the ignored `web/.env.e2e.local` file:

```dotenv
RECIPE_GENIE_E2E_TARGET=local
RECIPE_GENIE_E2E_BASE_URL=http://127.0.0.1:3107
RECIPE_GENIE_E2E_EMAIL=<test-account-email>
RECIPE_GENIE_E2E_PASSWORD=<test-account-password>
```

Run `npm run local:e2e:bootstrap` to start/reset local Supabase, seed the
dedicated user, and create the current worktree's ignored configuration. The
bootstrap can reuse these two machine-local credentials from another
registered Recipe Genie worktree without copying `.env.local`. Then run
`npm run test:e2e:inspect`. Local authentication accepts only port `3107` on
`localhost` or `127.0.0.1`; fixture operations require exactly the local
Supabase API at `http://127.0.0.1:54321`.

For a preview, copy the exact Recipe Genie deployment origin from authenticated Vercel deployment metadata. Set both `RECIPE_GENIE_E2E_BASE_URL` and `RECIPE_GENIE_E2E_ALLOWED_PREVIEW_ORIGIN` to that exact HTTPS origin, and set `RECIPE_GENIE_E2E_TARGET=preview`. The hostname must also use the constrained `recipe-genie-*.vercel.app` preview contract.

Production is deliberately guarded:

```dotenv
RECIPE_GENIE_E2E_TARGET=production
RECIPE_GENIE_E2E_BASE_URL=https://recipe-genie-peach.vercel.app
RECIPE_GENIE_E2E_ALLOW_PRODUCTION=true
RECIPE_GENIE_E2E_EMAIL=<test-account-email>
RECIPE_GENIE_E2E_PASSWORD=<test-account-password>
```

Before enabling production, verify the deployment’s Git commit and exact alias in authenticated Vercel metadata. Run only the read-only authenticated smoke selection. Production is never a fallback.

Authentication state is generated separately for each test under ignored `.playwright/auth/`, bound to the approved origin and a hashed user identity, and deleted after the test. Delete that directory to force cleanup after an interrupted run. Credential rotation requires updating the approved local/CI secret store and rerunning the smoke test; no tracked file should change.

GitHub Actions may eventually provide the same variables from repository secrets, but E2E execution must not be enabled until the test account and deterministic target are approved. Run `npm run check:e2e-secrets` before committing to reject tracked auth state, local E2E env files, hardcoded passwords, credential-bearing URLs, and the forbidden legacy test identifier.
