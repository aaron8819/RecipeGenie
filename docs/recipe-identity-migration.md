# Recipe identity migration

Classification: recipe identity migration + reference rewrite + compatibility contracts.

This document records the pre-implementation inventory, the redacted production impact audit performed on 2026-07-16, and the staged rollout contract. Production was read only. Migration 007 is Stage 1 only.

## Authority model

Before:

```text
recipe name
-> slug/text primary key
-> globally coupled identity
```

Endpoint:

```text
database-generated opaque UUID
-> immutable recipe identity
+ mutable, non-unique name
```

During Stage 1, `recipes.recipe_uuid` is the permanent UUID mapping and `recipes.id` remains the active compatibility primary key. The application continues to use the legacy key until all dependent fields can switch atomically.

## Producer inventory

| Producer | Current ID source | Collision behavior | Persisted before response | Final authority | Target action |
| --- | --- | --- | --- | --- | --- |
| Manual create (`useCreateRecipe`) | `sanitizeRecipeNameForStorage(name)` | Global collision; empty-like names can produce an empty ID | Yes, the same slug is optimistic and submitted | Client | Stage 2: one client `crypto.randomUUID()` per mutation attempt, used optimistically and durably |
| Pasted import | Parser fills the recipe dialog; dialog calls manual create | Same as manual create | Same as manual create | Client | Stage 2: use the manual UUID create contract |
| URL import | API extracts content only; dialog calls manual create | Same as manual create | Same as manual create | Client | Stage 2: use the manual UUID create contract |
| Default seeding (`handle_new_user`) | Fixed display-derived prefix plus random 8-character suffix | Low probability, still text/name-coupled | Server insert | Database function | Stage 2: omit ID and use UUID default |
| Share acceptance (`accept_recipe_share`) | Snapshot name slug plus random 8-character suffix | Low probability, still text/name-coupled | Atomic server insert | Database function | Stage 2: recipient-owned database UUID; return UUID |
| Planner replacement | Calls manual create for the replacement recipe | Same as manual create | Optimistic through manual mutation | Client | Stage 2: use the manual UUID create contract |
| Recipe duplication/copy | No separate production path found | N/A | N/A | N/A | Keep absent; any future path must use the UUID create contract |
| Image upload before create | Dialog derives a storage key from the edited name | Can overwrite/collide independently of the recipe insert | Object can be stored before recipe response | Client storage path | Stage 2: allocate the optimistic UUID before upload; retain existing object URLs |
| Migration/import script | Copies source text recipe IDs and embedded reference fields | Preserves source collisions | Bulk persistence | Migration script | Stage 2: translate through an explicit legacy-to-UUID map |
| Client optimistic recipe | Same sanitized name slug as manual insert | Two same-name pending creates collide in cache | Yes, in TanStack Query only | Client | Stage 2: stable UUID allocated once per mutation |

Imports do not directly persist recipes. They only produce dialog content, so manual create is the single application persistence path. No active production duplication feature was found.

## Reference register

| Location | Storage shape | Semantics | Deletion behavior | Migration action | FK |
| --- | --- | --- | --- | --- | --- |
| `recipes.id` | `text` PK | Legacy live identity | Row deletion | Rename to immutable `legacy_id` after UUID promotion | N/A |
| `recipes.recipe_uuid` | `uuid` unique, not null | Canonical identity | Row deletion | Stage 1 backfill; promote to `id` after all consumers switch | PK at endpoint |
| `weekly_plans.recipe_ids` | `text[]` | Live planner membership | Current UI removes explicitly | Convert resolvable members to `uuid[]`; block on unresolved active values | Array FK unavailable; validate in write contract |
| `weekly_plans.day_assignments` | JSON object keyed by ID | Live planner placement | Key removed with membership | Rewrite exact top-level keys through the map | No; validate against `recipe_ids` and ownership |
| `weekly_plans.made_recipe_ids` | `text[]` | Historical week marker | Can outlive recipe | Add nullable/resolvable UUID representation and preserve unresolved legacy value | No FK |
| `plan_templates.recipe_ids` | `text[]` | Live reusable selection | Missing recipes already skipped by selectors | Convert to `uuid[]`; require ownership on writes | Array FK unavailable; validate in write contract |
| `plan_templates.day_assignments` | JSON object keyed by ID | Live template placement | Follows template membership | Rewrite exact top-level keys | No; validate against template IDs |
| `recipe_history.recipe_id` | `text` | Historical event | Must survive recipe deletion | Add nullable `recipe_uuid`; retain immutable `legacy_recipe_id`/snapshot provenance when unresolved | No FK, or nullable `SET NULL` only if a live link is later useful |
| `recipe_shares.source_recipe_id` | `text` | Share snapshot provenance | Snapshot survives source deletion | Add nullable source UUID; preserve legacy value | No destructive FK |
| `recipe_shares.accepted_recipe_id` | `text` nullable | Accepted-copy provenance | Share record survives accepted recipe deletion | Add nullable accepted UUID; preserve legacy value | No destructive FK |
| `recipe_shares.source_recipe_snapshot` | JSON snapshot without identity | Historical content | Preserved | No identity rewrite | No FK |
| `shopping_recipe_contributions.recipe_id` | `text`, PK member and restrictive FK | Active authoritative contribution | Must be removed before recipe deletion | Convert to UUID with owner validation; retain composite `(user_id, recipe_id)` | `ON DELETE RESTRICT` |
| Contribution `snapshot` | JSON items with `sources[].recipeId` | Frozen provenance | Survives recomputation until contribution removal | Rewrite exact `items[*].sources[*].recipeId` where resolvable; preserve unresolved legacy field | No FK |
| `shopping_list.source_recipes` | `text[]` | Compatibility projection | Recomputed from contributions | Convert projection output to UUID; do not treat as authority | No FK |
| Shopping `items`, `already_have`, `excluded` | JSON `[*].sources[*].recipeId` | Mixed live/snapshot provenance | Manual/pantry state can outlive recipe | Rewrite resolvable values; preserve unresolved as `legacyRecipeId` and keep recipe name snapshot | No FK |
| `toggle_weekly_recipe_made` | Text parameter/result and text arrays | Live command plus historical write | Existing behavior | Replace exact signature with UUID contract in Stage 2; remove text overload | Function ownership check |
| `get_recipe_history_stats` | Text recipe ID result | Historical aggregate | Survives deletion | Return nullable UUID plus preserved legacy identity as required by UI | No FK |
| Shopping contribution RPC | Text arrays and JSON recipe IDs | Active command | Restrictive deletion flow | Replace exact signature/JSON validation with UUID, retain revision/idempotency semantics | Function validates owner |
| Share API and accept RPC | Request/response string IDs | Live source and created-copy identity | Snapshot preserved | Validate UUID, resolve only through explicit compatibility endpoint if retained | Owner check in query/RPC |
| TanStack recipe keys | Principal-scoped string IDs | Client live identity | Removed on principal transition | Keep principal prefix and switch detail/weekly members to UUID | N/A |
| Selected recipe/dialog/planner component state | In-memory strings | Client live identity | Ephemeral | Switch value semantics to UUID; labels remain names | N/A |
| Recipe image object key | `<user>/<legacy-id>.<ext>` | Storage locator, not database identity | Deleted via stored URL | Existing URLs remain unchanged; new uploads use UUID key | N/A |
| JSON-LD export | Does not export recipe IDs | External content snapshot | N/A | No compatibility work | N/A |
| Routes/bookmarks | No recipe-ID route or deep link found | N/A | N/A | No redirect required based on repository evidence | N/A |
| Browser storage | Only active home tab found | Not recipe identity | N/A | No migration | N/A |

No email link, analytics event, third-party integration, or public recipe URL containing a recipe ID was found. Existing image URLs embed legacy storage object names, but they are stored locators rather than lookup identity and must not be renamed during this migration.

## Production impact assessment

The read-only audit used service-role access only inside the local process and emitted aggregate counts plus short hashes for classification. It did not print recipe names, recipe IDs, user IDs, contents, or credentials.

| Reference category | Total | Resolvable | Historical/unresolved | Policy |
| --- | ---: | ---: | ---: | --- |
| Recipes | 351 | 351 | 0 | Assign one random UUID to every row |
| Weekly plan `recipe_ids` | 147 | 145 | 2 | Block Stage 2 until the two active stale values are explicitly reconciled |
| Weekly plan `day_assignments` keys | 128 | 126 | 2 | Block Stage 2; preserve in Stage 1 |
| Weekly plan `made_recipe_ids` | 72 | 72 | 0 | Map, retaining historical semantics |
| Template `recipe_ids` | 42 | 42 | 0 | Map all |
| Template day-assignment keys | 6 | 6 | 0 | Map all exact keys |
| Recipe history | 94 | 93 | 1 | Preserve unresolved legacy provenance; canonical UUID nullable |
| Share source IDs | 4 | 2 | 2 | Preserve snapshot and legacy provenance; canonical UUID nullable |
| Share accepted IDs | 3 | 2 | 1 | Preserve legacy provenance; canonical UUID nullable |
| Shopping item source entries | 240 | 225 | 15 | Map resolvable values; preserve unresolved snapshot provenance |
| Already-have source entries | 34 | 27 | 7 | Same preservation policy |
| Excluded source entries | 31 | 23 | 8 | Same preservation policy |
| Shopping contributions | 0 | 0 | 0 | Schema conversion still required and tested locally |

All 351 current recipe IDs are non-empty legacy text; none are UUID-formatted. There are 10 normalized-name groups shared across users, no duplicate-name group within one user, no malformed/empty recipe ID, and no active ownership mismatch.

The four unresolved active planner references represent three distinct redacted IDs: one array-only value, one assignment-only key, and one value present in both shapes. Each is isolated to one owner/week and has no matching history, template, share, or shopping provenance. They are classified as stale planner-only references, not recipes. Stage 1 leaves them untouched. Stage 2 must either remove them through an approved reconciliation or preserve an explicit legacy fallback; it must never invent a UUID.

## Chosen strategy

Use a phased dual-column migration.

- Canonical UUID owner: PostgreSQL. `recipe_uuid` defaults to `gen_random_uuid()` and is immutable after insert.
- Optimistic policy at the endpoint: the client allocates one UUID with `crypto.randomUUID()` before image upload and mutation, then submits that UUID. The database default remains authoritative for server-only paths. The UUID is reused for a retry of the same mutation attempt; independent user submissions receive independent UUIDs.
- Duplicate-name policy: names are mutable and non-unique, including within one owner.
- Legacy policy: retain the current globally unique text ID as an immutable compatibility alias until Stage 3. New Stage 2 recipes do not need display-derived aliases.
- Unresolved policy: never synthesize a relationship. Preserve historical/snapshot values as legacy provenance with nullable canonical UUID. Stop on unresolved active values.
- Cleanup endpoint: remove legacy command overloads and active legacy fields only after the application has written UUID references exclusively, production audits show zero active legacy reads/writes, the planner-only stale values are reconciled, and one full rollback window has elapsed.

An in-place type replacement was rejected because text arrays, JSON object keys, mixed shopping snapshots, and unresolved active planner values cannot be safely cast. A new recipes table was rejected because the existing table can carry a candidate UUID key without duplicating RLS, triggers, indexes, and content.

## Rollout stages

| Stage | Database change | Application change | Compatibility | Verification gate |
| --- | --- | --- | --- | --- |
| 1 (complete) | Add/backfill unique, not-null, immutable `recipes.recipe_uuid`; keep text PK and all references | Generated types and structural guard only | Deployed application behavior remains unchanged | Production mapping is complete and immutable |
| 2A (this PR) | Add/backfill UUID mirrors for active references; nullable UUID linkage for historical evidence; synchronize legacy writes | No application behavior switch | Migration deploys first; the old application continues to write legacy fields while triggers maintain exact UUID parity | Zero active unresolved refs, row-for-row migration assertions, security tests, clean reset, and redacted production dry run |
| 2B | Add exact UUID RPCs and switch create/import/default/share, queries, planner/templates/history/shopping/deletion to UUID | Canonical application identity becomes `Recipe.id = recipe_uuid`; legacy alias is mapped only at persistence boundaries | UUID columns already exist; explicit legacy compatibility resolution remains removable | Duplicate-name/rename, cache, API, planner, template, share, history, shopping, and deletion smoke |
| 2C | Reject legacy-only active writes and remove Stage 2A synchronization authority | Remove active legacy writes and fallback from core commands | Historical legacy snapshots and the explicit resolver remain for Stage 3 | UUID-only write contracts and a full rollback observation window |
| 3 | Promote UUID to `recipes.id`; rename old key to `legacy_id`; remove active legacy fields, triggers, and obsolete RPCs | Remove remaining compatibility reads and transitional types | New application only; rollback uses database backup plus prior matching app/schema pair | Zero legacy writes/reads for one rollback window, CI/preview/production smoke, catalog audit |

Stage 1 rollback is straightforward before later references depend on the UUID: drop the immutability trigger/function, unique constraint, and column. After Stage 2, rollback requires the preserved one-to-one legacy mapping and the prior matching application. Stage 3 requires an established Supabase backup/restore point and coordinated application rollback.

The maximum mismatch window for Stage 1 is unbounded-safe because current code ignores the additive column. Stage 2's additive database migration must precede the application and remain backward compatible for the deployment window. Stage 3 must be a coordinated schema/application release after telemetry and audit gates pass.

## Stage 1 boundaries and residual risks

Stage 1 intentionally does not convert application identity or claim the product now supports same-name recipes. It establishes the permanent mapping safely while leaving behavior unchanged. Remaining risks are the three distinct stale planner-only IDs, historical references not represented by live recipes, embedded JSON rewrite correctness, share/history deletion semantics, existing image object paths, production shapes absent from fixtures, and rollback complexity after reference migration.

## Planner reconciliation approval and Stage 2 gate

On 2026-07-16, the operator approved a narrow removal-only reconciliation for the three planner-only references. Ref-A is confirmed deleted and appears only as an assignment key. Ref-B is confirmed deleted and appears only in active recipe membership. Ref-C is ambiguous and appears in both active membership and assignment-key state; it has no exact current-recipe mapping or deterministic transition evidence. Ref-C must not be mapped by name similarity. No reference is mapped to another recipe, and no UUID is generated or assigned.

Migration `008_reconcile_stale_planner_references.sql` removes exactly these active fields:

- Ref-A: one assignment key;
- Ref-B: one recipe membership;
- Ref-C: one recipe membership and one assignment key;
- made-state: no values.

The migration identifies each owner/week row and stale value through SHA-256 fingerprints rather than committed raw identifiers. Before locking and updating a row, it verifies the row fingerprint, full active-field hashes, field counts, exact occurrence shape, absence from made-state, absence of any live recipe row, and absence from templates, history, shares, shopping source state, and shopping contributions. It aborts the transaction on any mismatch. Array filtering uses exact equality with ordinality so valid order is retained; assignment removal uses the exact top-level JSON key. Postconditions compare preserved fields, unrelated rows, planner-row count, recipe-row count, and the complete legacy-ID-to-UUID mapping.

Non-sensitive historical evidence is stored in the operator-only `private.planner_reference_reconciliation_audit` table. Each of the four removals records only the migration identifier, Ref-A/Ref-B/Ref-C label, one-way reference and planner-row fingerprints, action type, reason classification, and transaction timestamp. Raw stale values, recipe names, planner contents, user identifiers, and week values are not retained in the audit object.

The reusable count-only query at `supabase/verification/active_planner_reference_audit.sql` is the active Stage 2 gate. Migration and pgTAP postconditions require the post-reconciliation counts to be:

| Active field | Required count |
| --- | ---: |
| Unresolved recipe memberships | 0 |
| Unresolved assignment keys | 0 |
| Unresolved made-state values | 0 |

Local fixture contracts prove those zero counts and preservation guarantees. Migration 008 is now present in production migration history. The 2026-07-16 post-deployment count-only audit returned zero unresolved memberships, assignment keys, and made-state values, so the Stage 2A gate is clear.

Migration 008 is forward-only. If a precondition fails, the transaction rolls back without partial reconciliation. After successful production application, reversal requires an operator-reviewed restore from the pre-migration database backup or a new guarded forward migration; the audit intentionally does not retain raw stale values and is not a reconstruction source.

## Stage 2A active-reference schema

Migration `009_add_uuid_recipe_references.sql` is the first complete,
backward-compatible Stage 2 slice. It does not change application behavior.

### Post-reconciliation production assessment

The read-only audit was repeated immediately before migration design. It emitted
only aggregate counts. Every resolvable reference had the expected owner.

| Category | Total | UUID resolvable | Active unresolved | Historical unresolved | Stage 2A policy |
| --- | ---: | ---: | ---: | ---: | --- |
| Weekly membership | 145 | 145 | 0 | 0 | Ordered `uuid[]` mirror; strict same-owner synchronization |
| Weekly assignments | 126 | 126 | 0 | 0 | UUID-keyed JSON mirror; values preserved exactly |
| Weekly made-state | 72 | 72 | 0 | 0 | Ordered `uuid[]` mirror; strict same-owner synchronization |
| Template membership | 42 | 42 | 0 | 0 | Ordered `uuid[]` mirror |
| Template assignments | 6 | 6 | 0 | 0 | UUID-keyed JSON mirror |
| History | 94 | 93 | 0 | 1 | Nullable UUID linkage plus unchanged legacy evidence |
| Share source | 4 | 2 | 0 | 2 | Nullable sender-owned UUID; snapshot and alias retained |
| Share accepted copy | 3 | 2 | 0 | 1 | Nullable recipient-owned UUID; sender UUID is never reused |
| Shopping JSON source entries | 305 | 275 | 0 | 30 | Add `recipeUuid` when exact; add `legacyRecipeId` when unresolved |
| Shopping source array | 0 | 0 | 0 | 0 | Ordered `uuid[]` operational mirror |
| Shopping contributions | 0 | 0 | 0 | 0 | Required UUID identity and unique `(user_id, recipe_uuid)` |

Historical unresolved counts are not active commands. Pending share source
references are fully resolvable. No UUID is generated for a missing recipe.

### Reference-field strategy

| Location | Legacy compatibility field | Stage 2 canonical field | Policy in 2A |
| --- | --- | --- | --- |
| Weekly plans | `recipe_ids` | `recipe_uuids` | Strict ordered mirror |
| Weekly plans | `day_assignments` | `day_assignment_recipe_uuids` | Strict UUID-keyed mirror |
| Weekly plans | `made_recipe_ids` | `made_recipe_uuids` | Strict ordered mirror |
| Plan templates | `recipe_ids` | `recipe_uuids` | Strict ordered mirror |
| Plan templates | `day_assignments` | `day_assignment_recipe_uuids` | Strict UUID-keyed mirror |
| Recipe history | `recipe_id` | `recipe_uuid` | Nullable historical linkage |
| Recipe shares | `source_recipe_id` | `source_recipe_uuid` | Nullable snapshot provenance; pending must resolve |
| Recipe shares | `accepted_recipe_id` | `accepted_recipe_uuid` | Nullable recipient-owned linkage |
| Shopping list | `source_recipes` | `source_recipe_uuids` | Strict ordered operational mirror |
| Shopping JSON sources | `recipeId` | `recipeUuid` | Enriched in place; unresolved retains explicit `legacyRecipeId` |
| Contributions | `recipe_id` | `recipe_uuid` | Required same-owner UUID identity |

Database triggers maintain these mirrors when the old application writes legacy
fields. Active arrays reject unresolved, cross-owner, and duplicate canonical
references. Historical history/share/shopping evidence remains nullable and is
never guessed. Helper functions are inaccessible to application roles; existing
table RLS continues to protect the added columns.

Stage 2A rollback is a forward migration that drops the synchronization
triggers, indexes, constraints, helper functions, and added columns. Because the
old application remains on legacy fields, an application rollback is not needed
before Stage 2B. After Stage 2B begins writing UUID fields, rollback must use the
matching pre-2B application/schema pair.

### Deployment order

| Step | Database | Application | Compatibility | Gate |
| --- | --- | --- | --- | --- |
| 1 | Deploy migration 009 | Current legacy app | Old writes populate UUID mirrors through triggers | Every parity count in `stage2a_uuid_reference_audit.sql` is zero |
| 2 | No destructive schema change | Deploy Stage 2B UUID-aware app | UUID reads/writes plus one explicit legacy resolver | Duplicate-name, rename, planner/template/share/history/shopping smoke |
| 3 | Deploy migration 010 enforcement | Stage 2B app | Reject new legacy-only active writes; retain historical aliases | UUID-only commands pass and legacy-only commands fail |

Migration 009 must precede Stage 2B. Its mismatch window is safe because the
currently deployed application does not select or require the new fields, and
the database maintains parity for every legacy write. Stage 3 primary-key
promotion, alias removal, and compatibility cleanup remain explicitly out of
scope.
