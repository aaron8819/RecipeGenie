# Read-only migration preflights

Each migration that needs data-shape proof gets a separate SQL file. A preflight must:

- start with ON_ERROR_STOP and a read-only transaction;
- return counts or pass/fail state only, never customer rows or identifiers;
- fail closed when the migration ledger or required catalog objects are absent;
- check only conditions required by the named migration;
- roll back at the end.

Depending on the real migration, suitable checks include nulls, duplicates, invalid UUIDs, orphaned or cross-owner relationships, proposed-constraint violations, deprecated active-write formats, migration-ledger state, required functions/triggers/policies/indexes, planner references, canonical/legacy parity, and array/JSON mirror alignment. Application-version compatibility is release evidence, not something SQL should guess.

Migration 012 uses 012_enforce_uuid_active_recipe_writes.sql. Run it only after a separately authorized repair of the known orphan. It requires ledger versions exactly 001 through 011, migration-011 made-state state, recipe UUID/text parity, resolved membership/assignment/made references, aligned planner/template mirrors, duplicate multiplicity parity, no cross-owner references, compatible embedded shopping-source JSON with owner-aligned UUID metadata, and all Stage 2A/applicable Stage 2C pre-migration counters at zero. The backup manifest and migration assertion bind this preflight and the migration to the same Git commit with separate SHA-256 hashes.

Migration 013 uses 013_allow_uuid_shopping_contribution_replacement.sql. It requires the authoritative ledger to contain exactly 001 through 012, which also proves that 013 and every unexpected migration are absent. It verifies the migration-012 shopping contribution function and enabled trigger plus same-owner UUID/text identity parity for every existing contribution. It is read-only, returns no customer rows or identifiers, and rolls back unconditionally.

Migration 014 uses 014_add_recipe_yield_metadata.sql. It requires the authoritative ledger to contain exactly 001 through 013, verifies that `recipes.yield_metadata` is absent, checks the hardened recipe-share RPC and recipient-update predecessor contracts, and rejects every pending snapshot that the post-migration acceptance validator would reject. All six required snapshot keys (`name`, `category`, `servings`, `tags`, `ingredients`, and `instructions`) are checked explicitly with null-safe type predicates.

Migration 017 uses 017_remove_legacy_recipe_structure.sql. It requires the authoritative ledger to contain exactly 001 through 016, verifies the exact post-016 canonical and legacy recipe columns plus the canonical validators and writers, and rejects invalid canonical recipe rows or share snapshots. It returns aggregate pass/fail evidence only and rolls back unconditionally.

The parity matrix contains 185 explicit complete-snapshot expectations: 36 accepted and 149 rejected. Its categories are 89 general snapshot/metadata fixtures, 49 ingredient quantity-range fixtures, and 47 recipe yield-range fixtures. The original 171 fixtures remain in their original order; the 10 quantity branch fixtures and 4 yield-boundary fixtures are appended.

The focused rule-to-fixture mapping is:

- Quantity qualifiers positively cover no qualifier plus `about`, `around`, `approx`, `approx.`, and `approximately`; every `approx*` spelling normalizes to `approximately`.
- Quantity sources positively cover `authored`, `original-text`, and `legacy-synthesized`.
- Quantity common-field negatives directly cover wrong types for `version`, `kind`, `authored`, `source`, and `qualifier`. A nested range endpoint rational with an extra key proves exact two-key rational shape independently of the range object's own exact-shape check.
- Yield boundaries reject numeric `scalingBasis` values `0` and `10001`, accept `scalingBasis` exactly `10000` with ordinary endpoints, and separately accept an endpoint exactly `10000` with an ordinary in-range scaling basis.
- Existing range fixtures cover all three separators, fractional, mixed-number, decimal, and Unicode-fraction endpoints, authored/rational agreement, yield-kind semantics, legacy quantity projections, equal endpoints, descending endpoints, required keys/types, and supported exact shapes.

CI evaluates every fixture independently first against schema 013 plus the complete read-only migration-014 preflight, then against schema 014 via direct `private.recipe_share_snapshot_is_valid` evaluation. A positive preflight fixture requires a clean exit. A negative preflight fixture requires a nonzero exit with no spawn error or termination signal and exactly one recognized migration-014 validation rejection. Stderr may contain only that error line, optionally followed by the standard `CONTEXT:  PL/pgSQL function inline_code_block line N at RAISE` line emitted when this preflight's `DO` block raises the validation error. Any unrelated, duplicate, blank, or unrecognized diagnostic causes failure with complete stdout/stderr diagnostics. This is focused branch and boundary parity coverage, not a claim of exhaustive validation over every possible JSON value. The preflight returns no customer rows or identifiers and rolls back unconditionally.

The expected application evidence is the deployed Stage 2C application-ahead compatibility bridge plus the deletion-integrity repair. Repository history records those as deployed, but an operator must verify the authorized production application version at execution time. SQL must not infer it.

Do not run a preflight merely because a backup exists. Migrations 012 through
014 and destructive migration 017 separately require a verified disposable
restore. Migration 017 binds its aggregate-only post-016 restore assertion and
preparation/finalization procedure to the backup tooling commit.
