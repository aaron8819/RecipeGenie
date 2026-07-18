# Documentation Index

Start here when you need project documentation. This file defines which docs are canonical, which are supporting references, and which are historical only.

## Canonical Docs

| File | Purpose |
|------|---------|
| [`project_overview.md`](project_overview.md) | Canonical architecture overview: layers, domains, data flow, and where logic lives. |
| [`ARCHITECTURE_GUARDRAILS.md`](ARCHITECTURE_GUARDRAILS.md) | Canonical contributor guardrails: non-negotiable boundaries, refactor stopping points, and verification baseline. |
| [`operational-verification.md`](operational-verification.md) | Read-only deployment manifest, production verification, and data-integrity audit commands. |
| [`../decisions.md`](../decisions.md) | Canonical architecture decision log. Record durable architecture decisions here instead of adding new plan docs. |

## Secondary Reference Docs

| File | Purpose |
|------|---------|
| [`../README.md`](../README.md) | Setup, local development, deployment, and user-facing feature overview. |
| [`../supabase/SCHEMA.md`](../supabase/SCHEMA.md) | Database schema, RLS, functions, and migration reference. |
| [`recipes-component.md`](recipes-component.md) | Recipes domain reference. |
| [`planner-component.md`](planner-component.md) | Planner domain reference. |
| [`shopping-component.md`](shopping-component.md) | Shopping domain reference. |
| [`pantry-component.md`](pantry-component.md) | Pantry domain reference. |
| [`../web/tests/README.md`](../web/tests/README.md) | E2E test workflow and fixtures. |
| [`../CLAUDE.md`](../CLAUDE.md) | Agent-oriented repo instructions and quick-reference notes. |
| [`../changelog.md`](../changelog.md) | Release history. |

## Historical / Superseded Docs

These files are retained so older references still resolve. They are not active planning documents and should not be treated as a work queue.

| File | Status |
|------|--------|
| [`archive/ARCHITECTURE_REFACTOR_PLAN.md`](archive/ARCHITECTURE_REFACTOR_PLAN.md) | Superseded by `ARCHITECTURE_GUARDRAILS.md`. |
| [`archive/CODEX_REFACTOR_EXECUTION_PLAN.md`](archive/CODEX_REFACTOR_EXECUTION_PLAN.md) | Historical execution checklist from the completed refactor wave. |
| [`archive/execution-plan.md`](archive/execution-plan.md) | Compatibility pointer for older references. |

## Documentation Rules

1. Keep canonical docs small and stable.
2. Update the canonical doc for the area you changed in the same PR.
3. Do not create a new plan doc for completed or already-decided refactor work.
4. Record future architecture decisions in [`../decisions.md`](../decisions.md).
5. If a doc becomes historical, add a superseded notice instead of leaving it looking active.

Last updated: 2026-03-07
