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

Migration 014 uses 014_add_recipe_yield_metadata.sql. It requires the authoritative ledger to contain exactly 001 through 013, verifies that `recipes.yield_metadata` is absent, checks the hardened recipe-share RPC contract, and rejects structurally incompatible pending share quantity, package, and yield metadata. The migration's private validators remain the authoritative semantic acceptance boundary for exact rational/lexeme and canonical-unit coherence. The preflight is read-only, returns no customer rows or identifiers, and rolls back unconditionally.

The expected application evidence is the deployed Stage 2C application-ahead compatibility bridge plus the deletion-integrity repair. Repository history records those as deployed, but an operator must verify the authorized production application version at execution time. SQL must not infer it.

Do not run a preflight merely because a backup exists. Migrations 012 through 014 change active-write or RPC authority and separately require a verified disposable restore.
