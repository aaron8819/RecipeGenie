# Recipe Genie pre-migration backups

This directory provides a small PostgreSQL logical-backup gate. It creates one ownership-neutral custom archive, validates its table of contents, records SHA-256 and size, and keeps dump, archive validation, restore verification, Storage backup, and migration authorization as separate states. Every entry point requires PowerShell Core 7.4 or later; Windows PowerShell 5.1 is rejected.

## Repository findings (2026-07-29)

- The app uses @supabase/supabase-js and @supabase/ssr. Supabase SQL files under supabase/migrations are the migration source, and supabase_migrations.schema_migrations is the authoritative remote ledger.
- The linked repository project reference is eyaoahwzixqetjgfghsh. Treat this repository value as configuration evidence only; the backup command still requires an explicit expected reference.
- Migration 014_add_recipe_yield_metadata.sql is the current backup-gate default. Backup evidence hashes the exact Git blob at the executing commit and uses Git's clean-filter comparison to reject worktree drift without treating a platform-specific CRLF checkout as different source content.
- The migration-014 production pre-state is ledger versions exactly 001 through 013, with 014 and every unexpected version absent. This document records the required contract; it is not a fresh production observation.
- Migration 012 changes active-write authority: it requires UUID recipe creation, makes planner/template/history/share/shopping synchronization UUID-authoritative, restricts legacy RPC/table privileges, replaces active shopping and deletion paths, adds triggers/functions and a compatibility-use counter, and tightens catalog/data invariants. It is provisionally elevated risk and must not be downgraded without explicit human review.
- The current remote schema command is npx supabase --workdir .. db push from web, preceded by npm run db:preflight. Vercel has no repository migration hook and deployment does not automatically apply SQL migrations. CI starts/resets a local Supabase stack only.
- Existing database tooling includes the pinned Supabase CLI, local reset/pgTAP workflow, db-preflight, generated-type checks, Stage 2A/2C audits, and active-planner audit. PowerShell is used for operator work, but the existing checked-in database scripts are mainly SQL/Node.
- The linked URL file describes a session pooler. Direct PostgreSQL is preferred. Transaction pooling is not compatible with this dump workflow.
- Migrations use public and private application schemas, auth.users ownership references and auth.uid(), RLS policies, functions/RPCs, triggers, extensions (including pgcrypto/pgtap locally), and Supabase Storage. No active Realtime or Vault application dependency was found in repository code.
- User-uploaded recipe images are stored in the recipe-images Supabase Storage bucket. Database metadata is included when it is in dumped schemas, but object payloads are not.
- No existing repository backup script equates dump completion with restoration. Prior docs require backup-backed rollback but did not implement a verified logical-backup gate.

## Required inputs

The backup entry point resolves the repository root from its own checked-in script location; it never falls back to the caller's current directory. Repository identity requires the private `recipe-genie` package metadata in `web/package.json`, `supabase/migrations/001_baseline.sql`, and the canonical backup entry point and common module under `scripts/database`. Missing, unreadable, malformed, duplicate, or unrelated package metadata fails closed before any Management API or database access.

Set these exact variables in the current process environment only. User-level, machine-level, dotenv, command-line, Supabase CLI credential-store, and implicit fallback values are not read by this tooling:

- RECIPE_GENIE_PRODUCTION_DATABASE_URL: complete direct PostgreSQL URL, including password. A deliberately supplied compatible session-pooler URL is accepted only with AllowSessionPooler.
- RECIPE_GENIE_PRODUCTION_PROJECT_REF: expected 20-character Recipe Genie Supabase project reference.
- RECIPE_GENIE_SUPABASE_ACCESS_TOKEN: Supabase Management API token with only the metadata-read access needed by `GET /v1/projects/{ref}` (`projects:read` OAuth scope or the documented fine-grained `project_admin_read` permission).

Never paste the database URL or Management API token into chat, a command argument, source code, a transcript, or a Git-tracked `.env` file. Populate them through an approved secret source in the current process environment. Do not substitute an anon key, service-role key, database password, or application JWT for the Management API token.

The token is required because database-schema evidence alone cannot identify a Supabase project. Before any database connection or output directory is created, the script makes exactly one TLS Management API metadata read to `GET /v1/projects/{expected-ref}`. It requires an exact returned `ref`, `ACTIVE_HEALTHY` status, a present and internally consistent `database.host`, and endpoint compatibility. API errors, timeouts, malformed or duplicate JSON fields, redirects, missing fields, inactive status, and contradictions fail closed; Management API unavailability is never downgraded to a warning. The token is sent only in the Authorization header, is never a child-process argument, and is included in in-memory redaction inputs. No full response, token, database URL, or raw credential-bearing username is recorded in the manifest or summary.

The checkout must also have been linked independently with the Supabase CLI. The script reads `supabase/.temp/project-ref` and requires both it and `RECIPE_GENIE_PRODUCTION_PROJECT_REF` to equal `eyaoahwzixqetjgfghsh`. The separate read-only database probe requires `current_database() = postgres`, the permitted current-user policy, a server version, `public.recipes`, `public.pantry_items`, `public.user_config`, and the definition-specific exact migration ledger. Migration 014 requires `001` through `013`; migrations 012 and 013 remain supported with their exact earlier ledgers. Missing or contradictory local or control-plane evidence fails closed; connected schema/ledger disagreement stops before `pg_dump`.

In Supabase Dashboard, obtain the project reference from Project Settings / General, the direct connection string from Connect / Direct connection, and the database password from the project database credentials (reset it if it is not available). Check the server major version in Dashboard or with the documented read-only select version() query. The repository local major is 17, but the script queries the connected server and requires matching pg_dump major version.

For a direct connection, the normalized configured host must exactly equal Management API `database.host`; case, a trailing DNS dot, and IPv6 bracket notation are normalized without DNS lookup or substitution. Use the direct `db.PROJECT_REF.supabase.co` endpoint when local DNS/IPv6 permits.

If direct-host DNS or IPv6 fails, manually supply the compatible port-5432 session-pooler URL and add `-AllowSessionPooler`. The pooler hostname may legitimately differ from Management API `database.host`, so the gate instead requires an exact recognized `*.pooler.supabase.com` hostname, the exact `postgres.PROJECT_REF` login structure, explicit opt-in, the matching API project ref, and the internally consistent API direct database host. Unsafe substring host matching, transaction pooling on port 6543, endpoint discovery, DNS substitution, and implicit pooler selection are rejected.

## Commands for later authorized use

Recommended external root:

    C:\Users\<user>\RecipeGenieBackups

Run the migration-014 identity and SQL preflight without creating a backup:

    pwsh -File .\scripts\database\Backup-RecipeGenieProduction.ps1 -DestinationRoot 'C:\Users\<user>\RecipeGenieBackups' -PreflightOnly

`PreflightOnly` performs the same environment, repository, linked-project, endpoint, Management API, connected-database, exact-ledger, committed migration/preflight blob, and PostgreSQL-version gates, then runs the commit-bound SQL inside its declared read-only transaction. It removes its scratch directory, never invokes `pg_dump`, and leaves no backup artifact. Add `-AllowSessionPooler` only for an explicitly supplied port-5432 Session Pooler URL.

Create and validate a logical backup:

    pwsh -File .\scripts\database\Backup-RecipeGenieProduction.ps1 -DestinationRoot 'C:\Users\<user>\RecipeGenieBackups'

For a deliberately supplied compatible session pooler:

    pwsh -File .\scripts\database\Backup-RecipeGenieProduction.ps1 -DestinationRoot 'C:\Users\<user>\RecipeGenieBackups' -AllowSessionPooler

Verify an existing backup without a database connection:

    pwsh -File .\scripts\database\Test-RecipeGenieBackup.ps1 -BackupDirectory '<backup-directory>' -ExpectedProjectReference '<project-ref>' -MaximumAgeMinutes 60

Routine gate:

    pwsh -File .\scripts\database\Assert-RecipeGenieMigrationBackup.ps1 -BackupDirectory '<backup-directory>' -ExpectedProjectReference '<project-ref>'

Elevated/high-risk gate, including migrations 012, 013, and 014:

    pwsh -File .\scripts\database\Assert-RecipeGenieMigrationBackup.ps1 -BackupDirectory '<backup-directory>' -ExpectedProjectReference '<project-ref>' -RequireRestoreVerification

Storage-sensitive gate:

    pwsh -File .\scripts\database\Assert-RecipeGenieMigrationBackup.ps1 -BackupDirectory '<backup-directory>' -ExpectedProjectReference '<project-ref>' -RequireStorageBackup

After backup assertion and the migration-specific read-only preflight pass, stop for explicit owner authorization. Only then, in a separate command/authorization, run from web:

    npm run db:preflight
    npx supabase --workdir .. db push

The assertion scripts never generate or invoke those commands.

## Archive contract

database.dump is pg_dump custom format, compression level 6, with no owner or privileges. It includes only public, private, and supabase_migrations schemas and their data: application tables, application functions/RPCs, triggers, RLS definitions, and the migration ledger. It does not include Supabase Auth platform configuration, global roles, secrets, managed service configuration, or Supabase Storage object payloads. The manifest records these exclusions explicitly. pg_restore --list must succeed and show public.recipes, application functions, and supabase_migrations.schema_migrations before the manifest can say archiveValidated=true.

Native PostgreSQL processes run through `System.Diagnostics.Process` with an explicit executable and argument list. stdout and stderr are captured in memory, redacted, and only then written atomically to their final log paths, so raw credential-bearing native output is never persisted as a backup log. Normal stderr with exit zero is retained and does not fail the operation. Missing/nonzero exit codes fail closed.

The destination must be outside every worktree registered in the repository, not merely outside the checkout that launches the command. A backup is built under a name ending in `.incomplete`; only after archive, manifest, summary, and hashes are complete is that directory atomically published under its final name. Any caught failure is marked failed and moved to a `.failed` directory when possible. Verifiers reject failed, quarantined, and incomplete names.

The database URL is parsed once and supplied to PostgreSQL tools through temporary PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, and PGSSLMODE process environment values. It is never a command argument. Logs, manifest, summary, and emitted failures redact literal/URL-encoded passwords, full PostgreSQL URLs and query strings, Supabase tokens/service-role-like keys, JWTs, and temporary CLI-login credential patterns.

Each backup is bound to one supported migration definition and its matching read-only preflight. A definition fixes the expected applied migration range, pending migration number and path, production project reference, and restore policy. SHA-256 values are computed from the exact Git blobs at `gitCommitSha`; the manifest records both paths, hashes, and commit identity. The migration assertion requires the current HEAD, clean-filter worktree content, manifest commit, migration hash, and preflight hash all to agree. Migrations 012, 013, and 014 always require `restoreVerified=true`, even if the caller omits `-RequireRestoreVerification`.

For migration 014, hard stops include any missing required process variable; any project reference other than `eyaoahwzixqetjgfghsh`; missing or contradictory repository link or Management API identity; transaction pooling on port 6543; a Session Pooler without explicit opt-in; any endpoint or login mismatch; a ledger shorter than, longer than, or different from exactly 001 through 013; migration 014 already applied; an existing `recipes.yield_metadata` column; incompatible pending share snapshots; missing or changed migration/preflight files; failed PostgreSQL commands; archive marker, size, or SHA mismatch; stale/failed/quarantined artifacts; and missing disposable-restore evidence at the assertion gate.

A successful backup directory contains `database.dump`, `manifest.json`, `summary.txt`, and sanitized command logs under `logs/`. The manifest keeps `migrationAuthorizationGranted=false`; the scripts print that migration authorization is not granted. Backup creation, verification, assertion, and `PreflightOnly` never execute migration 014. Migration execution remains a separate, explicitly authorized operation.

Manifest schema version 3 makes control-plane identity evidence mandatory. Offline verification rejects all version 1 and version 2 manifests, as well as version 3 manifests missing the project-ref match, acceptable status, database-host match, repository-link match, connected database evidence, or final `identityVerification.verified=true`. This is an intentional compatibility break: older backups must not silently satisfy the stronger production identity gate.

## Risk policy

Routine examples are additive nullable columns, safe additive indexes/tables, backward-compatible functions, and additive constraints already proven by preflight. Require a fresh verified logical backup, archive/project/age/size/hash/ledger/marker checks, migration-specific preflight when applicable, and explicit human authorization. Disposable restore is optional unless the owner requires it.

Elevated examples include nontrivial backfills, uniqueness/null tightening, UUID conversion, active-write/RPC/trigger/RLS changes, authority replacement, integrity repair, and migrations 012 through 014. Require every routine item, data-shape preflight, documented forward repair, verified application compatibility, successful disposable restore, and explicit owner authorization.

High-risk examples include destructive removal, irreversible transforms, primary-key replacement, mass rewrites, auth-ownership changes, destructive RLS, broad ledger repair, or rollback requiring full restoration. Require every elevated item, rehearsal on the restored copy, tested repair/rollback, post-migration invariants, and explicit authorization.

Classification never authorizes a migration. Any active-write enforcement, identity/UUID migration, RPC replacement, trigger, RLS, destructive authority, existing-data repair, or tightened constraint requires disposable restore verification.

## Migration 012 sequence

1. Confirm the authorized commit, exact migration file, and hash.
2. Create and verify a fresh Recipe Genie production logical backup.
3. Restore the exact unmodified archive to an isolated compatible target; verify schema, ledger, aggregate counts, RLS, functions, triggers, and audits.
4. Obtain separate authorization for the known one-row production orphan repair; repair only that authorized orphan.
5. Rerun Stage 2A parity, active-planner, and migration-012 preflight checks. Require every applicable counter to be zero and ledger exactly 001 through 011.
6. Assert the gate with RequireRestoreVerification.
7. Stop for separate explicit migration authorization.
8. Run migration 012 separately, then smoke-test and verify invariants. Record immutable evidence.

The repair and migration must not share authorization. Required application evidence is the Stage 2C application-ahead bridge and deletion-integrity version. The forward-repair plan must preserve the matching UUID-aware application/schema pair; old legacy clients are not a safe rollback after 012.

## Disposable restore and limitations

Archive validation is mandatory for every migration backup but does not prove restorability. Elevated/high risk and migration 012 require a successful disposable restore; periodic restore drills are also recommended during routine-only periods. Restore the exact unchanged archive, never ignore restore errors, and do not substitute repository migration replay for backup restoration.

Control-plane verification confirms project metadata and endpoint compatibility; it does not prove that the resulting archive is restorable. Restorability remains a separate disposable-restore state and authorization.

An isolated compatible Supabase project or Supabase-local environment is preferred. Generic PostgreSQL is acceptable only when every required schema/extension is supported. Supabase-managed configuration, Auth platform configuration, global roles, secrets, and Storage object payloads need separate recovery treatment. Storage object files in recipe-images are not in database.dump.

The Free-plan operating model has no assumed Supabase-managed PITR. A future separately authorized restore-verification process may update restoreVerified and restoreVerification after preserving the original archive hash. This implementation never sets restoreVerified=true or storageFilesBackedUp=true.

Emergency recovery outline: stop writes, verify the exact artifact/hash and recovery target, obtain restore authorization, provision an isolated compatible target, restore without suppressing errors, validate ledger/schema/data/security objects, then choose a reviewed forward repair or controlled cutover. Do not overwrite production as an exploratory restore.
