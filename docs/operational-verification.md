# Operational verification

Recipe Genie exposes a read-only `GET /api/version` endpoint with immutable build metadata:

- Git commit SHA, when supplied by the build platform
- build timestamp
- application version from `web/package.json`
- expected latest migration identifier
- expected Supabase project reference

The endpoint never reads or returns credentials, connection strings, tokens, or runtime infrastructure configuration. Missing local Git metadata is returned as `null`.

## Vercel build metadata

Vercel automatically provides `VERCEL_GIT_COMMIT_SHA` when [Automatically expose System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables) is enabled. `web/next.config.js` copies that value into the immutable build manifest.

The build timestamp defaults to the time Next.js evaluates `next.config.js`. For a reproducible external build timestamp, set `RECIPE_GENIE_BUILD_TIMESTAMP` to an ISO-8601 value in the build command environment. `RECIPE_GENIE_GIT_SHA` may similarly override Vercel's SHA for a controlled non-Vercel build. Do not set either value to a secret.

## Production verification

Run with explicit target identity. The command never guesses a production target and opens the database transaction as `READ ONLY`:

```bash
npm run verify:production -- \
  --app-url https://recipe-genie.example.com \
  --expected-sha 0123456789abcdef0123456789abcdef01234567 \
  --expected-project-ref eyaoahwzixqetjgfghsh \
  --database-url 'postgresql://...'
```

Equivalent environment variables are `RG_PRODUCTION_URL`, `RG_EXPECTED_GIT_SHA`, `RG_EXPECTED_SUPABASE_PROJECT_REF`, and `RG_DATABASE_URL`. The database URL is consumed in memory and never printed. Use a database principal with only the read permissions needed for catalog and application-table inspection.

Use the direct PostgreSQL endpoint. Transaction-pooler endpoints (port 6543) are always rejected. A session pooler (port 5432) is accepted only when repository policy explicitly permits it and the operator supplies `--allow-session-pooler`. Both the database session default and the transaction itself are forced read-only.

The verifier prints one concise `PASS`, `FAIL`, or `SKIP` line per check and exits nonzero on failure. It verifies HTTP availability, the public deployment manifest, the exact expected SHA and project identity, read-only connectivity, migration history, the expected latest migration, critical catalog objects, retired objects, and representative reads.

## Data integrity audit

```bash
npm run audit:data -- --database-url 'postgresql://...'
npm run audit:data -- --database-url 'postgresql://...' --json --sample-limit 10
```

`RG_DATABASE_URL` and `RG_AUDIT_SAMPLE_LIMIT` are supported. The limit must be 1–50. The audit runs inside one read-only transaction and has no repair or apply mode. It exits nonzero when it finds an `ERROR`-severity violation; warnings remain visible without failing the command.

Checks are derived from the current schema, UUID identity migrations, shopping contribution architecture, recipe validation, and lifecycle tests. Recipe ingredients are embedded JSON, not relational ingredient rows. Recipe import is a stateless HTTP parsing flow, so the audit explicitly skips import-record state instead of inventing a persistence contract.
