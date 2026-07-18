# Read-only migration preflights

Each migration that needs data-shape proof gets a separate SQL file. A preflight must:

- start with ON_ERROR_STOP and a read-only transaction;
- return counts or pass/fail state only, never customer rows or identifiers;
- fail closed when the migration ledger or required catalog objects are absent;
- check only conditions required by the named migration;
- roll back at the end.

Depending on the real migration, suitable checks include nulls, duplicates, invalid UUIDs, orphaned or cross-owner relationships, proposed-constraint violations, deprecated active-write formats, migration-ledger state, required functions/triggers/policies/indexes, planner references, canonical/legacy parity, and array/JSON mirror alignment. Application-version compatibility is release evidence, not something SQL should guess.

Migration 012 uses 012_enforce_uuid_active_recipe_writes.sql. Run it only after a separately authorized repair of the known orphan. It requires ledger versions exactly 001 through 011, migration-011 made-state state, recipe UUID/text parity, resolved membership/assignment/made references, aligned planner/template mirrors, duplicate multiplicity parity, no cross-owner references, compatible embedded shopping-source JSON with owner-aligned UUID metadata, and all Stage 2A/applicable Stage 2C pre-migration counters at zero. The backup manifest and migration assertion bind this preflight and the migration to the same Git commit with separate SHA-256 hashes.

The expected application evidence is the deployed Stage 2C application-ahead compatibility bridge plus the deletion-integrity repair. Repository history records those as deployed, but an operator must verify the authorized production application version at execution time. SQL must not infer it.

Do not run this preflight merely because a backup exists. Migration 012 remains elevated risk and separately requires a verified disposable restore.
