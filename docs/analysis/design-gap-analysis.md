# Design Doc vs. Recipe Genie: Gap Analysis & ROI Recommendations

> **Source:** Comparison of `docs/recipemgmtsystem_design.md` against existing Recipe Genie system (v2.13.1)
> **Date:** 2026-02-08

---

## What Recipe Genie Already Does Well

The design doc identifies 5 core domains. Recipe Genie covers all five, which puts it ahead of every single competitor in the landscape matrix (none do all five well):

| Domain | Design Doc MVP | Recipe Genie Status |
|--------|---------------|-------------------|
| Recipe storage | URL import, manual entry, search/tags/categories | Manual entry + text import, search, tags, categories, images |
| Meal planning | Drag-drop calendar, meal slots | Random generation + calendar view, day assignments, settings |
| Shopping lists | Aggregation, aisle sort, pantry deduction | Smart merging, unit normalization, category assignment, pantry deduction, excluded keywords, drag-reorder |
| Pantry tracking | Items, approximate quantities | Simple item list + excluded keywords |
| Recipe history | Track what was cooked | History with configurable exclusion window |

The shopping list merging/normalization pipeline is genuinely sophisticated — the design doc calls ingredient aggregation the "#1 smart feature users cite" and Recipe Genie already has it with unit conversion.

---

## Highest-ROI Improvements (ranked)

### 1. URL Recipe Import — *The single biggest gap*

**Impact: Critical | Effort: Medium**

The design doc calls this "the core value proposition — users come for this first." Every competitor has it. Currently Recipe Genie only supports paste-from-text, which means users must manually copy/paste recipe content from web pages.

**Approach:** Use a Next.js API route that fetches a URL, extracts Schema.org JSON-LD `<script type="application/ld+json">` with `@type: "Recipe"` (covers ~90% of food blogs via WordPress SEO plugins). No need for the full Python `recipe-scrapers` library — JSON-LD parsing in TypeScript is straightforward. Feed extracted data into the existing `parseRecipeText()` pipeline.

**Why highest ROI:** Transforms recipe entry from a multi-step copy-paste chore to a single URL paste. This is the feature that makes users choose a recipe app.

### 2. Cook Mode — *Low effort, high kitchen utility*

**Impact: High | Effort: Low**

The design doc says this is "consistently cited as make-or-break." Structured instructions already exist in `instructions[]` — just need a presentation layer.

**What to build:**
- Full-screen overlay with large text, one step at a time
- Wake Lock API (`navigator.wakeLock.request('screen')`) to keep screen on
- Previous/Next step buttons (big touch targets)
- Ingredient checklist view alongside

This is ~1 new component leveraging existing recipe data. Very high bang for the buck.

### 3. Meal Plan Templates — *Most requested unbuilt feature in the market*

**Impact: High | Effort: Low**

The design doc identifies this as "the most requested feature nobody has built well" — save a week as a reusable template, rotate on cycles. The data model already has `weekly_plans` with `recipe_ids[]` and `day_assignments`.

**What to build:**
- "Save as Template" button on planner (stores recipe IDs + day assignments + name)
- New `plan_templates` table or JSONB array in `user_config`
- "Load Template" picker when generating a new plan
- Optional: rotation schedule (apply template A this week, B next week...)

Very little code relative to the value. The 4-6 week rotation use case the doc highlights would immediately serve power users.

### 4. Data Export — *Reduces lock-in anxiety, builds trust*

**Impact: Medium | Effort: Very Low**

The design doc lists this as MVP and calls out "no data export creates lock-in anxiety that drives users to competitors."

**What to build:** A "Download My Recipes" button that exports all recipes as JSON (Schema.org/Recipe format for interoperability). Could also offer a simple printable HTML/PDF format. This is maybe 50 lines of code.

### 5. "What Can I Make?" — *Closes the pantry loop*

**Impact: High | Effort: Medium**

The design doc's thesis is that no app closes the loop from pantry -> recipe suggestion -> meal plan -> shopping -> pantry. Recipe Genie is 80% of the way there — just needs the pantry -> recipe suggestion step.

**What to build:**
- Query recipes, score by percentage of ingredients matching pantry items
- "What can I make?" button on Pantry tab
- Results ranked by match % with "missing N ingredients" labels
- "Add missing to shopping list" one-tap action

The challenge is matching accuracy (pantry uses exact string matching — "garlic" won't match "garlic cloves"). A substring/contains approach would be a practical improvement without needing full normalized food entities.

### 6. Preserve `original_text` on Ingredients — *Future-proofing, nearly free*

**Impact: Low-Medium | Effort: Very Low**

The design doc's architectural decision #2: always store raw imported text alongside parsed data. Currently the `Ingredient` type has `{ item, amount, unit, modifier? }` but no `original_text`. Adding this field is trivial and enables re-parsing with improved algorithms later.

---

## Deprioritized Items

| Design Doc Recommendation | Why Deprioritize |
|--------------------------|-----------------|
| **Normalized food/unit entities** | The doc's #1 architectural recommendation, but would be a massive migration with moderate near-term payoff. String-based merging pipeline works well enough. Revisit if adding nutrition or "what can I make?" at scale. |
| **Family sharing / CRDTs** | Very high effort (groups, permissions, real-time sync). Only matters for multi-user households. |
| **Meal slots (breakfast/lunch/dinner)** | Category-based planning model works differently from drag-drop-into-slots paradigm. Adding slots would require significant replumbing. |
| **Nutrition info** | Requires API integration (Spoonacular/Edamam), ongoing cost, and normalized food entities to do properly. |
| **Offline-first / mobile app** | Web app. PWA could help but native mobile is a separate product. |
| **Recipe scaling display** | Scaling exists at shopping list level. Per-recipe scaling in UI is nice but not critical. |

---

## Summary: Top 6 in Priority Order

| # | Feature | Impact | Effort | Why Now |
|---|---------|--------|--------|---------|
| 1 | **URL Recipe Import** | Critical | Medium | The #1 reason users adopt recipe apps |
| 2 | **Cook Mode** | High | Low | Leverages existing data, kitchen utility |
| 3 | **Meal Plan Templates** | High | Low | Most requested unbuilt feature in the market |
| 4 | **Data Export** | Medium | Very Low | Trust-builder, ~50 lines of code |
| 5 | **"What Can I Make?"** | High | Medium | Closes the pantry->recipe loop |
| 6 | **Preserve original_text** | Low | Very Low | Future-proofs ingredient pipeline |

Items 2-4 and 6 could ship in a single sprint. Item 1 is the strategic priority. Item 5 is the differentiator that closes the loop the design doc identifies as the market's structural gap.
