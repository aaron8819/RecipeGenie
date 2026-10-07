# Planner read and Shopping focus corrections

Base: `bfc216f71fbc5e97dbafa60acaf0a2daf9461902`.
Both findings were inherited from its integration base, not introduced by the
Planner Slice 4 layout work. The independent review is retained in the
`planner-slice4-independent-review` worktree's `.codex-artifacts/review/REVIEW.md`.

## Bounded changes

- Pending reads show a loading status. Failed reads show an alert and explicit
  Retry. Cached meals and all plan actions are hidden until recovery; unavailable
  data never renders a confirmed empty week. A successful empty read retains the
  existing empty-week actions. Retry only refetches the query.
- Planner per-meal and full-week Shopping callers capture the actual opening
  button, including WebKit pointer activation. Existing dialog focus containment,
  submission and connected/enabled-trigger fallback remain in place.
- Successful Planner layout, shell, mutation workflows, approved gap dispositions,
  hooks, shared dialogs, APIs, contracts and migrations are unchanged.

## Focused proof

The final interaction regression file fails seven assertions against the exact
parent component: cached/uncached read errors, pending reads, both pointer
triggers, and removed/disabled actual-trigger fallback. Its other 16 assertions
pass. With the corrections, the interaction and template-load files pass all
27 tests.

Authenticated production-build Chromium and WebKit at 1440×900, 390×844 and
320×844 pass 72 focused browser checks: held loading, read rejection/explicit
Retry, recovery of five saved meals with identical persisted plan rows and no
recovery writes, both Shopping entry points opened by pointer/keyboard and
closed by Escape/Cancel, focus containment/return, partial five-serving selection
submission/reload, full-week submission, and removed-trigger fallback. All six
disposable owners are cleaned; no page errors or horizontal overflow were seen.

Local WebKit uses the independent review's browser-only removal of HTTP
`upgrade-insecure-requests`; this proves local behavior with that qualification,
not native Safari or production CSP behavior. Diagnostics, screenshots, harness,
source identities, carried-forward evidence hashes and exact-commit gate results
are retained in this worktree's ignored `.codex-artifacts/fixes/` packet.

## Recipe integration boundary

Accepted Recipe head: `22387af6ce1eefe0fc4c46f0f8e61161ee6eafe9`. Its shared
Shopping selector still accepts `onCloseAutoFocus`; these caller-only changes
require no shared-dialog edit. Its branch was neither modified nor integrated.

The eventual combined head needs both engines/all three sizes for Recipe card
and detail, Planner per-meal/full-week and Dashboard Shopping: explicit trigger
focus, grouped flattened ordinals, saved-yield precedence, select/deselect-all,
long dialog/footer geometry, source/read/command recovery, Recipe return-week
state, and separate Recipe global-history Undo versus Planner weekly cooking
semantics. Recheck these two fixes on that actual combined head. Existing
unaffected PASS evidence is carried forward as source-qualified evidence, not
claimed as freshly rerun or as a combined-head verdict.
