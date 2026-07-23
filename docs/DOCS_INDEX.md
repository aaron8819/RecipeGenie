# Documentation Index

Start here when you need project documentation. This file defines which docs
own each kind of guidance, which are supporting references, and which are
historical only. When documents disagree, use the owner listed here rather
than combining conflicting instructions.

## Authoritative Documents

| File | Purpose |
|------|---------|
| [`../AGENTS.md`](../AGENTS.md) | Authoritative Codex operating policy, including startup, authorization boundaries, worktrees, risk language, and final handoff. |
| [`../README.md`](../README.md) | Human onboarding, supported local setup, feature overview, and entry points to specialist documentation. |
| [`project_overview.md`](project_overview.md) | Current architecture overview: layers, domains, data flow, and where logic lives. |
| [`ARCHITECTURE_GUARDRAILS.md`](ARCHITECTURE_GUARDRAILS.md) | Canonical contributor guardrails: non-negotiable boundaries, refactor stopping points, and verification baseline. |
| [`operational-verification.md`](operational-verification.md) | Read-only deployment manifest, production verification, and data-integrity audit commands. |
| [`../supabase/SCHEMA.md`](../supabase/SCHEMA.md) | Current database shape, active migration chain, compatibility behavior, and migration runbook. |
| [`../decisions.md`](../decisions.md) | Durable architecture decision log; superseded decisions remain historical context. |
| [`../web/tests/README.md`](../web/tests/README.md) | E2E commands, target guards, fixtures, and authentication-state lifecycle. |

## Secondary Reference Docs

| File | Purpose |
|------|---------|
| [`recipes-component.md`](recipes-component.md) | Recipes feature behavior, boundaries, and focused verification. |
| [`planner-component.md`](planner-component.md) | Planner feature behavior, boundaries, and focused verification. |
| [`shopping-component.md`](shopping-component.md) | Shopping feature behavior, boundaries, and focused verification. |
| [`pantry-component.md`](pantry-component.md) | Pantry feature behavior, boundaries, and focused verification. |
| [`../CLAUDE.md`](../CLAUDE.md) | Technical agent quick reference and doc router; subordinate to `AGENTS.md` for Codex policy and to the specialist owner for detailed behavior. |
| [`../changelog.md`](../changelog.md) | Release history. |

## Historical / Superseded Docs

These files are retained so older references still resolve. They are not active planning documents and should not be treated as a work queue.

| File | Status |
|------|--------|
| [`archive/ARCHITECTURE_REFACTOR_PLAN.md`](archive/ARCHITECTURE_REFACTOR_PLAN.md) | Superseded by `ARCHITECTURE_GUARDRAILS.md`. |
| [`archive/CODEX_REFACTOR_EXECUTION_PLAN.md`](archive/CODEX_REFACTOR_EXECUTION_PLAN.md) | Historical execution checklist from the completed refactor wave. |
| [`archive/execution-plan.md`](archive/execution-plan.md) | Compatibility pointer for older references. |
| [`recipe-identity-migration.md`](recipe-identity-migration.md) | Historical identity-migration design, audits, and rollout evidence; current state belongs in `supabase/SCHEMA.md`. |

## Documentation Rules

1. Keep canonical docs small and stable.
2. Update the canonical doc for the area you changed in the same PR.
3. Do not create a new plan doc for completed or already-decided refactor work.
4. Record future architecture decisions in [`../decisions.md`](../decisions.md).
5. If a doc becomes historical, add a superseded notice instead of leaving it looking active.

Last updated: 2026-07-23
