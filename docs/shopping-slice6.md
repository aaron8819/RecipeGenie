# Shopping Slice 6: authoritative V3 commands

Slice 6 establishes the server/transaction boundary. It does not activate V4,
convert identity or manual meaning, implement obtained-basis coverage, or
complete the Shopping foundation. Production rollout is separately authorized.

## Write flow and inventory

1. The browser retains an owner-scoped attempt in session storage before any
   request. It sends protocol 1, semantic mutation and observed preconditions.
2. `/api/shopping` checks Origin against Host, validates the authenticated user
   with `getUser()`, bounds the request to 1 MiB, validates command structure,
   and hashes canonical JSON with SHA-256. Owner never comes from the body.
3. Service-only `shopping_admit` allocates the database sequence and expiry.
   `shopping_command_context` checks the ticket/receipt first, then reads a
   consistent owner document, dependency epoch, Pantry, source and inverse
   snapshot under the protocol owner lock.
4. `shopping-command-planner.ts` reuses the existing pure V3 reducer, Slice 5
   manual collision rule, structural reader and frozen source resolver. It
   validates against that snapshot. The browser's preview/validation is not
   authoritative. Source capture must match current owned recipe evidence.
5. Service-only `shopping_commit` reacquires the owner lock and compares the
   document revision and dependency epoch. It checks the issued ticket and
   payload binding before any domain work. A stale plan returns Replan without
   a terminal result. The server may replan once with the same command; further
   races leave Pending and produce recoverable feedback.
6. Document changes, Pantry side effects or recipe deletion, and the compact
   terminal receipt commit together. Domain rejections/no-ops also get receipts;
   no-op/rejection does not advance content revision. Cache updates stay within
   the owner and never replace a larger revision with historical receipt state.

| Former writer | Slice 6 treatment |
|---|---|
| Shopping hook direct `UPDATE(document, content_revision)` | Removed; all manual, check/bulk check, source, order, config, exclusion, Clear and inverse commands use the endpoint. Table and column update grants revoked. |
| Initialization | Signup's trusted trigger remains. Missing rows read as empty without writing; first applied command inserts under owner lock. |
| Pantry bridge replacement RPC | Application caller removed; EXECUTE revoked from application and service roles. New bridge derives the item from current Shopping and commits availability and transition together. |
| `delete_recipe` | Legacy public entry point only raises refresh-required. Existing owner-scoped cleanup is private, non-callable by application/service roles and invoked only from commit. Recipe hook uses the endpoint; direct recipe DELETE grants revoked. |
| Recipe edit/add and ordinary Pantry writes | Do not replace Shopping. Their triggers advance the owner dependency epoch, preventing stale dependency snapshots from committing. Deletion remains coordinated with Shopping cleanup. |
| Historical recipe-deletion compatibility adapter | Retained for historical unit contracts; no production hook imports it. Old RPC cannot fall through to its missing-RPC fallback. Direct DELETE is denied even to that fallback. |
| Recovery and retry | Exact saved command/ticket only. No new-ID fallback. Visible retry control resolves saved attempts after reload. Unknown outcomes require a successful current-list read and explicit acknowledgement before new actions are allowed. |

The service key is server-only. Public service RPCs have no PUBLIC/anon/
authenticated execution privileges. Privileged functions use an empty search
path; private tables have RLS enabled with no application policies or grants.
The generated public types describe RPC signatures, not permission to call them.
Privileged database administration is outside the application threat boundary.

## Admission and receipt semantics

- 15 minutes from trusted admission, maximum 256 retained slots per owner.
- Owner + sequence + UUID + canonical-payload hash must all match to execute.
- Pending slots contain no command body. Receipts contain bounded outcome,
  revision, Pantry identity/result and Undo availability; maximum 2 KiB each.
- Duplicate executions serialize under the owner lock. A committed result is
  returned as AlreadyApplied, including original rejection/revision, before
  target validation. No old document is returned with a historical receipt.
- Lost admission responses use recovery lookup, never admission again. Repeated
  retained UUID/hash recovers the same sequence and expiry; changed payload is
  PayloadMismatch. Outside retention recovery is OutcomeUnknown.
- At capacity, RetryCapacity includes the earliest trusted expiry. No unexpired
  Pending or completed slot is evicted. Capacity refusal proves no admission.
- Only expired prefix slots are reclaimed. The persistent floor increases and
  survives Clear/Undo; expiry is nondecreasing by sequence. Below-floor tickets
  are RetryExpired; absent/unissued tickets are UnknownAdmission.
- Execute cannot create an admission. A UUID alone is not replay authority.
  A deliberate fresh admission is a new sequence; an old sequence never becomes
  executable again after cleanup. This is not permanent exactly-once delivery.
- Transport/transaction failure leaves Pending. The retry panel reuses stored
  payload and preconditions even when the current UI has changed. Lost/corrupt
  metadata does not cause an automatic replacement submission.

## Compatibility, preservation and deferrals

Migration 022 rewrites no existing document or recipe. V2 reads still upgrade
in memory; command writes are V3. A strict SQL command validator rejects JSON
null as well as malformed/unsupported shapes, closing an older validator's
three-valued-logic edge case. Unsupported originals receive terminal refusal
and remain unchanged. A private legacy-envelope validator is prepared and
tested against Slice 5 fixtures, but V4 candidate content remains read-only;
its final persistence/initialization is Slice 7, not an implicit conversion.

Manual quantities remain extras under the current V3 collision restrictions.
Same-identity amount edits preserve frozen sources and all saved organization.
Independent manual additions and unchanged-target edits can rebase; old
pre-Clear content and conflicting targets refuse. Exclusion/family intents
retain Slice 2's conservative rules. Full replacement settings, ingredient
moves and other stale V3 content commands require the observed revision.
V3 value comparisons cannot promise persistent same-field ABA detection;
complete field-version organization behavior remains Slice 9.

Clear captures its actual successful preimage. Only a manual-only inverse of
at most 1 MiB is retained, for 10 minutes, outside receipts. Recipe-bearing
Clear has no enabled Undo. Undo checks fixed revision, expiry and the stored
inverse, never trusting client replacement content, and consumes the inverse
atomically. Empty Clear has no inverse/write. Size limits or historical receipt
replay give explicit unavailable/history feedback. Any intervening document
write still refuses Undo; content epochs, fresh trip generation, organization-
only Undo and source-safe recipe-bearing Undo remain Slice 8.

No command regenerates source evidence during unrelated edits. Existing
organization sequences, including hidden/dormant purchases, are retained by
the boundary. Existing V3 ordering algorithms are unchanged; Slice 5's target
append/splice rules, including its documented hidden-slot correction, activate
in Slices 7/9. No new ordering or coverage guarantees are claimed here.

## Deployment and rollback constraints

No deployment occurred. Future authorized rollout must stage this compatible
application/service artifact, then atomically apply the reviewed database fence
before serving command writers. A brief write-unavailable interval is explicit:
old browser writes are denied once the fence is applied. Reads remain available.
The prior app must not remain the intended writable application after 022.
There is no feature flag that reopens direct writes and no fallback endpoint.

Reverting only the application to Slice 5 leaves its writes denied. Recovery is
a command-compatible application or read-only operation plus forward repair.
Do not reopen grants or obsolete RPC execution as an application rollback.
Target V4 conversion remains a separate Slice 7 operation under repository
runbooks; source/coverage/trip semantics remain separately reviewed changes.

## Verification map

| Scenarios | Evidence |
|---|---|
| S05/S74/S107–S111 | `web/scripts/test-shopping-protocol.ts`: real same-ticket races, dropped-result replay, admission recovery, payload mismatch, concurrent capacity boundary, expiry/floor/unknown sequence and owner isolation. |
| S10/S11/S48 | Source/Pantry epoch races, source mismatch refusal, atomic recipe deletion/receipt and Pantry bridge; pgTAP deletion integrity retains planner/template/owner cleanup assertions. |
| S69/no-op/conflict | Current-state planner tests and real no-op/conflict receipt replay. Receipt-update fault injects transaction failure and proves state rollback/Pending preservation. |
| S71/S73/S116 | Real RLS/grants and service-only privileges; persisted unsupported-document refusal; JSON/legacy structural parity; owner-switch unit tests. |
| S01–S04/S18–S21/S38/S40/S55/S72 | Existing Slice 1–5 regression suites plus frozen-evidence/organization assertions in planner and desktop/mobile browser flows. |
| S101/S102 | Existing conditional Clear tests plus real stored inverse, fixed-revision Undo and consumed-inverse refusal. Recipe-bearing Undo stays disabled. |
| Browser delivery | `web/tests/shopping-protocol.spec.ts`, standalone config at 1440×900 and 390×844, two authenticated sessions. Response dropping and request synchronization are browser interception; actual mutation/receipt outcomes come from the isolated database. |

Exact local commands, migration rehearsals, screenshots, final gate, commit/tree
and remaining evidence are in ignored `.codex-artifacts/slice6/review.md`.

Next slice: **7 — Explicit data initialization, identity/extra grouping and
append order**, including operable legacy envelopes and first-appearance slots.
