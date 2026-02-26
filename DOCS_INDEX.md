# DOCS_INDEX.md

Every documentation file in the project — what it covers, who reads it, and when.

---

## Active Documentation

### Core Reference (read first)

| File | Audience | When to read |
|------|----------|-------------|
| [`CLAUDE.md`](CLAUDE.md) | Claude Code / engineers | Every session — commands, conventions, architecture, gotchas, doc router |
| [`project_overview.md`](project_overview.md) | Engineers | First session or architecture questions — 10-min orientation, data flow, adding features |
| [`decisions.md`](decisions.md) | Engineers | Major refactors or "why was this built this way?" — ADRs 001–021 |
| [`changelog.md`](changelog.md) | Engineers | Version history (v2.8+) — what shipped in each release |
| [`README.md`](README.md) | New users / deployers | Setup, installation, usage guide, deployment to Vercel |

### Component Deep-Dives

| File | Domain | When to read |
|------|--------|-------------|
| [`docs/recipes-component.md`](docs/recipes-component.md) | Recipes | Recipe CRUD, parser, URL import, cook mode, sharing, tags, categories |
| [`docs/planner-component.md`](docs/planner-component.md) | Planner | Plan generation, day assignments, templates, date handling, history |
| [`docs/pantry-component.md`](docs/pantry-component.md) | Pantry | Pantry items, excluded keywords, What Can I Make?, shopping integration |
| [`docs/shopping-component.md`](docs/shopping-component.md) | Shopping | Shopping list architecture, merging, normalization, hook tests |

### Database & Testing

| File | When to read |
|------|-------------|
| [`supabase/SCHEMA.md`](supabase/SCHEMA.md) | Any database work — tables, migrations, RLS, indexes, functions |
| [`web/tests/README.md`](web/tests/README.md) | Writing or debugging E2E tests — Playwright setup, fixtures, auth |

---

## Archived Documentation

Historical plans and code reviews that have been fully completed or superseded. Kept for reference only — do not update.

Located in [`docs/archive/`](docs/archive/):

| File | Why archived |
|------|-------------|
| `high-roi-features.md` | All 6 features shipped (v2.13.0–v2.15.0) |
| `recipe-parser-improvements-2026-02.md` | P0–P3 shipped; P4–P5 deferred indefinitely |
| `security-hardening-2026-02.md` | All code phases complete (CSP, rate limiting, SSRF guard) |
| `design-gap-analysis.md` | Pre-implementation gap analysis — all items resolved |
| `comprehensive-code-review-2026-02-09.md` | All findings resolved (2026-02-10) |
| `web-src-code-review-2026-02-09.md` | All findings resolved (2026-02-10) |
| `recipe-mgmt-system-design.md` | External research reference — not tied to active implementation |

---

## Ownership Rules

1. **Every doc has exactly one audience.** If two audiences need different things, split into two files.
2. **Docs describe what the code does, not what was planned.** Unimplemented features do not appear.
3. **When you ship a feature, update the relevant doc in the same PR.** Stale docs are bugs.
4. **When a plan/analysis is fully resolved, move it to `docs/archive/`.** Do not delete — the history is useful.
5. **CLAUDE.md is highest priority.** It is read every session. Keep it accurate and concise.

---

*Last updated: 2026-02-26 (v2.15.0)*
