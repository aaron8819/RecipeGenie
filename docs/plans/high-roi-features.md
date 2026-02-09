# Implementation Plan: 6 High-ROI Features

## Context

Comparison of `docs/recipemgmtsystem_design.md` against the existing Recipe Genie system identified 6 highest-ROI improvements. This plan covers all 6, ordered to minimize dependencies and maximize incremental value. Full analysis saved at `docs/analysis/design-gap-analysis.md`.

---

## Implementation Order

```
F6 (originalText) → F1 (URL Import) → F4 (Data Export) → F2 (Cook Mode) → F3 (Templates) → F5 (What Can I Make?)
```

**Rationale:** F6 is a 5-minute type change that unblocks F1 and F4. F1 establishes the first API route pattern and is highest user value. F4 is a quick win after F1. F2/F3/F5 are independent and ordered by ascending complexity.

---

## Feature 6: Preserve `original_text` on Ingredients

**Goal:** Add `originalText?: string` to `Ingredient`, populated during parsing. Enables re-parsing and lossless export.

### Changes

| File | Change |
|------|--------|
| `web/src/types/database.ts` | Add `originalText?: string` to `Ingredient` interface |
| `web/src/lib/recipe-parser.ts` | Set `originalText` to the cleaned input line in `parseIngredientLine()` |

**No DB migration needed** — `ingredients` is JSONB; optional fields are backward-compatible.

### Verification
- Run `npm run test` — existing parser tests should still pass
- Add a test asserting `originalText` is populated on parsed ingredients

---

## Feature 1: URL Recipe Import

**Goal:** User pastes a recipe URL → server fetches page → extracts Schema.org JSON-LD → populates recipe dialog.

### New dependency
- `cheerio` (server-only) — HTML parsing for JSON-LD extraction. ~2MB, does not affect client bundle.

### Files to create

| File | Purpose |
|------|---------|
| `web/src/app/api/recipe-import/route.ts` | Next.js API route — fetches URL, authenticates user, returns extracted data |
| `web/src/lib/recipe-url-parser.ts` | Pure extraction: HTML string → structured recipe. Reuses `parseIngredientLine()` from `recipe-parser.ts` |
| `web/src/lib/__tests__/recipe-url-parser.test.ts` | Unit tests with fixture HTML strings |
| `web/src/hooks/use-recipe-import.ts` | `useImportRecipeFromUrl()` — TanStack mutation wrapping `/api/recipe-import` |

### Files to modify

| File | Change |
|------|--------|
| `web/src/components/recipes/recipe-dialog.tsx` | Add URL input field at top of Import tab. Flow: enter URL → call hook → show preview (same preview step as text import) → apply to form |
| `web/package.json` | Add `cheerio` |

### Extraction strategy (in `recipe-url-parser.ts`)
1. Parse all `<script type="application/ld+json">` blocks
2. Find `@type: "Recipe"` objects (handle `@graph` nesting)
3. Map Schema.org fields to our types:
   - `recipeIngredient[]` → each string through `parseIngredientLine()` → `Ingredient[]`
   - `recipeInstructions` → handle string[], HowToStep[], HowToSection[]
   - `recipeYield` → parse number for `servings`
   - `image` → handle string, string[], ImageObject → store external URL in `image_url`
   - `name` → recipe name
4. Fall back to Open Graph meta tags for name/image if no JSON-LD found
5. Return warnings for missing/incomplete data

### API route (`route.ts`) design
- `POST` handler, accepts `{ url: string }`
- Authenticate via `createClient()` + `getUser()` — reject unauthorized
- Validate URL format
- Fetch with 10s timeout, custom User-Agent
- Pass HTML to `extractRecipeFromHtml()`
- Return structured result or error

### Image handling
- **v1: Store external URL directly.** The existing `getRecipeImageUrl()` in `storage.ts` already handles external URLs. `recipe-detail-dialog.tsx` already uses `unoptimized={true}` for non-Supabase URLs.
- **v2: Download and re-upload to Supabase Storage.**

### Verification
- `npm run test` — unit tests for `recipe-url-parser.ts` with fixture HTML
- Manual test: paste a URL from a popular recipe blog (e.g., allrecipes.com, seriouseats.com) into the import tab
- Verify preview shows name, ingredients, instructions, image
- Verify "Apply & Edit" populates the form correctly
- Verify saved recipe has `originalText` on ingredients and `image_url` pointing to external image

---

## Feature 4: Data Export

**Goal:** "Export Recipes" button downloads all recipes as Schema.org/Recipe JSON-LD.

### Files to create

| File | Purpose |
|------|---------|
| `web/src/lib/recipe-export.ts` | `recipesToSchemaOrg(recipes)` → JSON-LD array; `downloadRecipesAsJson(recipes)` → triggers browser download via Blob + URL.createObjectURL |
| `web/src/lib/__tests__/recipe-export.test.ts` | Unit tests for Schema.org output shape |

### Files to modify

| File | Change |
|------|--------|
| `web/src/components/recipes/recipe-list.tsx` | Add "Export" button (Download icon) in header actions area. Calls `downloadRecipesAsJson(recipes)`. |

### Export format
- Each recipe maps to a `Schema.org/Recipe` JSON-LD object
- `recipeIngredient[]` uses `originalText` if available, otherwise reconstructs from `amount + unit + item`
- `recipeInstructions` as `HowToStep[]`
- File named `recipe-genie-export-YYYY-MM-DD.json`

### Verification
- Unit tests for export format
- Manual test: click Export, open downloaded file, verify valid JSON-LD
- Verify file contains all recipes with correct fields

---

## Feature 2: Cook Mode

**Goal:** Full-screen step-by-step cooking view with large text, Wake Lock, and ingredient checklist.

### Files to create

| File | Purpose |
|------|---------|
| `web/src/components/recipes/cook-mode.tsx` | Full-screen overlay — step display, ingredient checklist, navigation |
| `web/src/hooks/use-wake-lock.ts` | Custom hook wrapping Screen Wake Lock API with `request()`, `release()`, `isSupported` |

### Files to modify

| File | Change |
|------|--------|
| `web/src/components/recipes/recipe-detail-dialog.tsx` | Add "Start Cooking" button (ChefHat icon). Renders `<CookMode>` overlay when active. |

### Component design (`cook-mode.tsx`)
- **Fixed overlay** (`fixed inset-0 z-50`) — covers entire viewport, no routing needed
- **Header:** Recipe name + close button (X)
- **Ingredient checklist:** Collapsible section at top, checkboxes for each ingredient, amounts displayed via `toFraction()`
- **Step content:** Large centered text (2xl on mobile, 4xl on desktop), current instruction step
- **Navigation footer:** Previous/Next buttons (large touch targets, min h-14), step counter ("Step 3 of 8")
- **Keyboard nav:** Arrow keys for prev/next, Escape to close
- **Wake Lock:** Auto-request on mount, release on unmount. Graceful degradation if unsupported.
- **No DB changes** — purely client-side using existing `recipe.instructions[]` and `recipe.ingredients[]`

### Verification
- Manual test: open recipe detail → click "Start Cooking" → verify overlay, step navigation, ingredient checklist
- Verify screen stays on (test on mobile)
- Verify keyboard navigation works
- Verify close button exits cook mode

---

## Feature 3: Meal Plan Templates

**Goal:** Save current week's plan as a named template. Load templates to populate new weeks.

### Database changes

New table `plan_templates`:

```sql
CREATE TABLE plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  day_assignments JSONB DEFAULT NULL,
  category_selection JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plan_templates_user_id ON plan_templates(user_id);
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own_templates ON plan_templates
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_plan_templates_updated_at
  BEFORE UPDATE ON plan_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Files to create

| File | Purpose |
|------|---------|
| `supabase/migrations/015_plan_templates.sql` | Migration SQL above |
| `web/src/hooks/use-plan-templates.ts` | `usePlanTemplates()`, `useSavePlanTemplate()`, `useDeletePlanTemplate()` — standard TanStack Query hooks following existing patterns |
| `web/src/components/planner/save-template-dialog.tsx` | Dialog with name input, saves current plan's recipe_ids + day_assignments + category selection |
| `web/src/components/planner/load-template-dialog.tsx` | List of templates with name, recipe count, created date. Load applies template to current week. Delete with confirmation. |

### Files to modify

| File | Change |
|------|--------|
| `web/src/types/database.ts` | Add `PlanTemplate` type |
| `web/src/components/planner/meal-planner.tsx` | Add "Save as Template" + "Load Template" buttons in header area |
| `supabase/SCHEMA.md` | Document new table |

### Template load behavior
- Fetch template's `recipe_ids`, check which still exist in `recipes` table
- Filter out deleted recipes, warn user if any were removed
- Apply to current week via existing `useSaveWeeklyPlan()`
- Optionally apply `day_assignments` if present

### Verification
- Run migration against Supabase
- Manual test: generate a plan → save as template → navigate to different week → load template → verify plan populated
- Test deleted recipe handling: delete a recipe, load a template that referenced it, verify warning
- E2E test: save/load template round-trip

---

## Feature 5: "What Can I Make?"

**Goal:** Reverse recipe search from pantry items. Recipes ranked by ingredient match percentage.

### Files to create

| File | Purpose |
|------|---------|
| `web/src/lib/pantry-matcher.ts` | `matchRecipesToPantry(recipes, pantryItems)` → `RecipeMatch[]` sorted by match% |
| `web/src/lib/__tests__/pantry-matcher.test.ts` | Unit tests for matching logic |
| `web/src/hooks/use-pantry-match.ts` | Combines `useRecipes()` + `usePantryItems()`, calls matcher, memoizes results |
| `web/src/components/pantry/what-can-i-make.tsx` | Results modal — recipe cards with match %, missing ingredients, "add missing to list" action |

### Files to modify

| File | Change |
|------|--------|
| `web/src/components/pantry/pantry-list.tsx` | Add "What Can I Make?" button above pantry items |

### Matching algorithm (`pantry-matcher.ts`)

Fuzzy matching rules (priority order):
1. **Exact match:** normalized ingredient name == pantry item
2. **Substring contains:** pantry item found within ingredient name ("garlic" matches "garlic cloves")
3. **Reverse substring:** ingredient name found within pantry item ("tomato" matches "cherry tomatoes")
4. **Word-level:** significant word (3+ chars) from ingredient matches a pantry item

Results sorted by: match% descending, then missing count ascending.

**`RecipeMatch` shape:**
```typescript
interface RecipeMatch {
  recipe: Recipe;
  matchedIngredients: string[];
  missingIngredients: Ingredient[];
  matchPercentage: number;
  totalIngredients: number;
}
```

Reuses `normalizeItemName()` from `shopping-list-normalization.ts` for consistent normalization.

### UI design (`what-can-i-make.tsx`)
- Modal/dialog triggered from Pantry tab
- Filter toggle: "Can make now" (100% match) vs. "All recipes" (sorted by match%)
- Each result card: recipe name, category pill, match% bar, "Missing N" label
- Expandable missing ingredients list
- "Add missing to shopping list" button per recipe

### Verification
- Unit tests for matching: exact, substring, word-level, sorting, edge cases (empty pantry, no-ingredient recipes)
- Manual test: add pantry items → click "What Can I Make?" → verify ranked results
- Test fuzzy matching: add "garlic" to pantry, verify it matches recipes with "garlic cloves"

---

## Summary: All Files

### New files (16)
1. `web/src/app/api/recipe-import/route.ts`
2. `web/src/lib/recipe-url-parser.ts`
3. `web/src/lib/__tests__/recipe-url-parser.test.ts`
4. `web/src/hooks/use-recipe-import.ts`
5. `web/src/lib/recipe-export.ts`
6. `web/src/lib/__tests__/recipe-export.test.ts`
7. `web/src/components/recipes/cook-mode.tsx`
8. `web/src/hooks/use-wake-lock.ts`
9. `supabase/migrations/015_plan_templates.sql`
10. `web/src/hooks/use-plan-templates.ts`
11. `web/src/components/planner/save-template-dialog.tsx`
12. `web/src/components/planner/load-template-dialog.tsx`
13. `web/src/lib/pantry-matcher.ts`
14. `web/src/lib/__tests__/pantry-matcher.test.ts`
15. `web/src/hooks/use-pantry-match.ts`
16. `web/src/components/pantry/what-can-i-make.tsx`

### Modified files (8)
1. `web/src/types/database.ts` — `originalText` on Ingredient, `PlanTemplate` type
2. `web/src/lib/recipe-parser.ts` — populate `originalText`
3. `web/src/components/recipes/recipe-dialog.tsx` — URL import UI in Import tab
4. `web/src/components/recipes/recipe-list.tsx` — Export button
5. `web/src/components/recipes/recipe-detail-dialog.tsx` — "Start Cooking" button
6. `web/src/components/planner/meal-planner.tsx` — Template save/load buttons
7. `web/src/components/pantry/pantry-list.tsx` — "What Can I Make?" button
8. `supabase/SCHEMA.md` — Document `plan_templates` table

### New dependency
- `cheerio` (server-only, for URL import)
