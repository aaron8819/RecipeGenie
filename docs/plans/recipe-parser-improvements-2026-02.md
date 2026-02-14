# Recipe Parser & Import UX Improvements

## Status

**Implementation completed: 2026-02-14 (v2.15.0)**

- ✅ **P0: Mixed Fraction Fix** - Completed
- ✅ **P1: Live Import Preview** - Completed
- ✅ **P2: Alternative Ingredients** - Completed
- ✅ **P3: Ingredient Validation Indicators** - Completed (with soft warning modification)
- ⏸️ **P4: Smart Ingredient Reordering** - Deferred (low value, high brittleness)
- ⏸️ **P5: Pre-Ingredient Adjectives** - Deferred (edge case, not urgent)

**Result:** All high-value improvements shipped. P0-P3 deliver ~90% of the value for ~50% of the total effort. P4-P5 deferred due to diminishing returns.

---

## Context

Recent work on modifier extraction (parenthetical, "for X" patterns) revealed several opportunities to enhance the recipe import/parsing experience. Analysis identified 6 improvements ranging from critical bug fixes to significant UX enhancements. This plan orders them by impact and implementation effort.

**Current state:** The parser successfully handles comma-separated modifiers, parenthetical prep instructions, and "for X" patterns. However, mixed fractions are incorrectly parsed ("1¾" → "10.75"), and the import flow requires multiple clicks with no preview feedback.

**Goal:** Fix critical parsing bugs, add live preview for instant feedback, and capture more recipe patterns (alternatives, prep adjectives).

---

## Priority Ranking

| Priority | Feature | Effort | Impact | Type | Status |
|----------|---------|--------|--------|------|--------|
| **P0** | Mixed Fraction Fix | 30 min | High | Bug Fix | ✅ Shipped |
| **P1** | Live Import Preview | 2-3 hrs | Very High | UX Enhancement | ✅ Shipped |
| **P2** | Alternative Ingredients | 1-2 hrs | Medium | Feature | ✅ Shipped |
| **P3** | Ingredient Validation Indicators | 1 hr | Medium | UX Polish | ✅ Shipped |
| **P4** | Smart Ingredient Reordering | 1 hr | Low | Nice-to-Have | ⏸️ Deferred |
| **P5** | Pre-Ingredient Adjectives | 1-2 hrs | Low | Edge Case | ⏸️ Deferred |

**Implementation order:** P0 → P1 → P2 → P3 (completed). P4-P5 deferred.

---

## P0: Fix Mixed Fraction Parsing (Critical Bug)

**Problem:** "1¾ cups flour" parses as amount: 1, unit: "10.75 cups" because `normalizeUnicode()` does string replacement ("1" + "¾"→"0.75" = "10.75").

**Solution:** Detect mixed fractions (digit immediately followed by Unicode fraction) and convert properly before replacing standalone fractions.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/lib/recipe-parser.ts:307-321`](web/src/lib/recipe-parser.ts#L307-L321) | Update `normalizeUnicode()` to handle mixed fractions first |

### Implementation

```typescript
function normalizeUnicode(text: string): string {
  let normalized = text

  // Step 1: Handle mixed fractions FIRST (e.g., "1¾" → "1.75")
  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    // Match whole number + fraction with NO space between
    const mixedPattern = new RegExp(`(\\d+)${char}`, 'g')
    normalized = normalized.replace(mixedPattern, (match, whole) => {
      const wholeNum = parseFloat(whole)
      return (wholeNum + value).toString()
    })
  }

  // Step 2: Handle standalone fractions (existing logic)
  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replace(new RegExp(char, 'g'), value.toString())
  }

  // Step 3: Replace dashes (existing)
  normalized = normalized.replace(/[–—]/g, "-")

  return normalized
}
```

### Tests to Add/Update

```typescript
// In web/src/lib/__tests__/recipe-parser.test.ts
describe('mixed fraction parsing', () => {
  it('should correctly parse mixed fractions', () => {
    const result = parseIngredientLine('1¾ cups flour')
    expect(result.amount).toBe(1.75) // NOT 1
    expect(result.unit).toBe('cups') // NOT "10.75 cups"
    expect(result.item).toBe('flour')
  })

  it('should handle multiple mixed fractions in the same line', () => {
    const result = parseIngredientLine('1½–1¾ cups flour')
    expect(result.amount).toBe(1.5)
    expect(result.unit).toBe('1.5-1.75 cups')
  })

  it('should still handle standalone fractions', () => {
    const result = parseIngredientLine('¾ cup sugar')
    expect(result.amount).toBe(0.75)
    expect(result.unit).toBe('cup')
  })

  it('should preserve originalText with Unicode fractions', () => {
    const result = parseIngredientLine('1¾ cups flour')
    expect(result.originalText).toBe('1¾ cups flour')
  })
})
```

Update failing test at line 131-136 to expect correct parsed values.

### Verification

- Run `npm run test -- --run src/lib/__tests__/recipe-parser.test.ts`
- All tests pass, especially new mixed fraction tests
- Manual test: Import recipe with mixed fractions (e.g., banana bread example) → verify amounts are correct

**Impact:** Fixes ~30% of recipes that use mixed fractions. Critical for recipe accuracy.

---

## P1: Live Import Preview (Major UX Win)

**Problem:** Current flow is paste → click "Parse & Preview" → wait → see results. No feedback while typing. Users don't know if parsing will work until they click.

**Solution:** Real-time preview panel showing parsed results as user types (debounced). Instant validation feedback.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/components/recipes/recipe-dialog.tsx`](web/src/components/recipes/recipe-dialog.tsx) | Add live preview UI in import tab |

### New State & Logic

```typescript
// Add to RecipeDialog component
const [livePreview, setLivePreview] = useState<ParsedRecipe | null>(null)

// Debounced parsing (300ms)
const debouncedParse = useMemo(
  () =>
    debounce((text: string) => {
      if (!text.trim()) {
        setLivePreview(null)
        return
      }
      try {
        const parsed = parseRecipeText(text)
        setLivePreview(parsed)
      } catch (error) {
        setLivePreview(null)
      }
    }, 300),
  []
)

// Update textarea onChange
<Textarea
  value={importText}
  onChange={(e) => {
    setImportText(e.target.value)
    setParseError(null)
    debouncedParse(e.target.value)
  }}
  // ...
/>
```

### UI Layout Changes

Transform import tab from single-column to two-column layout:

```tsx
<TabsContent value="import" className="...">
  {importStep === 'input' ? (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT: Input */}
      <div className="space-y-4">
        <Label>Import from URL</Label>
        {/* URL input (existing) */}

        <div className="relative">
          <Label>Paste Recipe Text</Label>
          <Textarea
            value={importText}
            onChange={handleTextChange}
            rows={16}
            className="font-mono text-sm"
          />
        </div>
      </div>

      {/* RIGHT: Live Preview */}
      <div className="space-y-4">
        <Label>Live Preview</Label>
        {livePreview ? (
          <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
            {/* Name */}
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Recipe Name
              </div>
              <div className="font-medium text-lg">{livePreview.name}</div>
            </div>

            {/* Quick Stats */}
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <ChefHat className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {livePreview.ingredients.length}
                </span>
                <span className="text-muted-foreground">ingredients</span>
              </div>
              <div className="flex items-center gap-1.5">
                <List className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {livePreview.instructions.length}
                </span>
                <span className="text-muted-foreground">steps</span>
              </div>
            </div>

            {/* Warnings */}
            {livePreview.warnings.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-semibold mb-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  PARSING NOTES
                </div>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                  {livePreview.warnings.slice(0, 3).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Ingredient Preview (first 5) */}
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2">
                Ingredients Preview
              </div>
              <div className="space-y-1 text-sm">
                {livePreview.ingredients.slice(0, 5).map((ing, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground min-w-[60px]">
                      {ing.amount ? `${ing.amount} ${ing.unit}`.trim() : '—'}
                    </span>
                    <span>{ing.item}</span>
                  </div>
                ))}
                {livePreview.ingredients.length > 5 && (
                  <div className="text-xs text-muted-foreground italic">
                    +{livePreview.ingredients.length - 5} more
                  </div>
                )}
              </div>
            </div>

            {/* Call to Action */}
            <Button
              onClick={handleApplyPreview}
              className="w-full"
              disabled={livePreview.warnings.some(w =>
                w.includes("No ingredients") || w.includes("No instructions")
              )}
            >
              <Check className="h-4 w-4 mr-2" />
              Apply to Form
            </Button>
          </div>
        ) : (
          <div className="bg-muted/10 border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Paste recipe text to see live preview
            </p>
          </div>
        )}
      </div>
    </div>
  ) : (
    // Existing preview step (kept for URL import)
    <div className="space-y-4">
      {/* ... existing preview state UI ... */}
    </div>
  )}
</TabsContent>
```

### Flow Changes

1. **Text Import:** User types → Live preview updates (debounced) → Click "Apply to Form" → Switches to Manual tab
2. **URL Import:** Keep existing flow (input → parse → preview step → apply)

### Verification

- Manual test: Open Add Recipe → Import tab → Start typing a recipe → Preview updates in real-time
- Verify debouncing works (no lag while typing)
- Verify warnings show correctly
- Verify "Apply to Form" populates manual entry form
- Test mobile layout (should stack vertically on small screens)

**Impact:** Transforms import from "hope and pray" to "instant confidence". Users see results immediately, catch errors early.

---

## P2: Alternative Ingredient Detection

**Problem:** "2 tablespoons Greek yogurt or sour cream" currently parses as a single item. Loses information about substitutions.

**Solution:** Detect "X or Y" pattern, store primary item + alternatives. Render both in UI.

### Database Impact

**No migration needed.** Extends existing `Ingredient` interface with optional field:

```typescript
// In web/src/types/database.ts
export interface Ingredient {
  item: string
  amount: number | null
  unit: string
  shoppingCategory?: string
  modifier?: string
  alternatives?: string[]  // NEW
  originalText?: string
}
```

`ingredients` is JSONB in Postgres → backward-compatible.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/types/database.ts:273-280`](web/src/types/database.ts#L273-L280) | Add `alternatives?: string[]` to `Ingredient` |
| [`web/src/lib/recipe-parser.ts:279-289`](web/src/lib/recipe-parser.ts#L279-L289) | Add `extractAlternatives()` call after modifier extraction |

### Implementation

```typescript
// Add to recipe-parser.ts after extractModifier

/**
 * Extract alternative ingredients from "X or Y" pattern
 * Only extracts if pattern is clear substitution, not modifier context
 */
function extractAlternatives(item: string): {
  item: string;
  alternatives?: string[]
} {
  // Ignore if it's a modifier context
  if (/(to taste|as needed|or unpeeled)/i.test(item)) {
    return { item }
  }

  // Match "X or Y" pattern (case-insensitive)
  const altPattern = /^(.+?)\s+or\s+(.+)$/i
  const match = item.match(altPattern)

  if (match) {
    const [_, primary, alternative] = match
    return {
      item: primary.trim(),
      alternatives: [alternative.trim()]
    }
  }

  return { item }
}

// In parseIngredientLine, after extractModifier:
const { item: baseItem, modifier } = extractModifier(item)
const { item: finalItem, alternatives } = extractAlternatives(baseItem)

return {
  item: finalItem,
  amount: amount,
  unit: unit,
  modifier: modifier || undefined,
  alternatives: alternatives,
  originalText,
}
```

### UI Changes

Show alternatives in recipe displays:

```tsx
// In recipe-detail-dialog.tsx ingredient list
{ingredient.item}
{ingredient.alternatives && ingredient.alternatives.length > 0 && (
  <span className="text-muted-foreground">
    {' or '}
    {ingredient.alternatives.join(' or ')}
  </span>
)}
{ingredient.modifier && (
  <span className="text-muted-foreground">, {ingredient.modifier}</span>
)}
```

Apply same pattern in:
- [`web/src/components/recipes/recipe-card.tsx`](web/src/components/recipes/recipe-card.tsx) (hover tooltip)
- [`web/src/components/planner/plan-card.tsx`](web/src/components/planner/plan-card.tsx) (if showing ingredients)
- Import preview in recipe-dialog.tsx

### Shopping List Impact

When generating shopping list from plan, include alternatives as note:

```typescript
// In shopping-list.ts
const itemName = ingredient.alternatives?.length
  ? `${ingredient.item} (or ${ingredient.alternatives.join(', ')})`
  : ingredient.item
```

### Tests

```typescript
describe('alternative ingredient detection', () => {
  it('should extract "or" alternatives', () => {
    const result = parseIngredientLine('2 tablespoons Greek yogurt or sour cream')
    expect(result.item).toBe('Greek yogurt')
    expect(result.alternatives).toEqual(['sour cream'])
    expect(result.amount).toBe(2)
    expect(result.unit).toBe('tablespoons')
  })

  it('should not extract "or" in modifier context', () => {
    const result = parseIngredientLine('2 cups potatoes (peeled or unpeeled)')
    expect(result.item).toBe('potatoes')
    expect(result.alternatives).toBeUndefined()
    expect(result.modifier).toBe('peeled or unpeeled')
  })

  it('should handle "to taste" patterns', () => {
    const result = parseIngredientLine('Salt or pepper to taste')
    expect(result.item).toBe('Salt or pepper to taste')
    expect(result.alternatives).toBeUndefined()
  })
})
```

### Verification

- Unit tests pass
- Manual test: Import recipe with "yogurt or sour cream" → verify parsed correctly
- Check recipe detail view shows alternatives
- Check shopping list includes note with alternatives

**Impact:** Captures ~15-20% of recipes with substitution suggestions. Better shopping list generation.

---

## P3: Ingredient Validation Indicators

**Problem:** Form only validates on submit. Users don't know which ingredients are incomplete until they click "Add Recipe".

**Solution:** Real-time visual indicators for missing/inconsistent data.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/components/recipes/recipe-dialog.tsx:784-829`](web/src/components/recipes/recipe-dialog.tsx#L784-L829) | Add validation icons to ingredient inputs |

### Implementation

Add validation helper:

```typescript
function validateIngredient(ing: Ingredient) {
  const issues: string[] = []

  if (!ing.item.trim()) {
    issues.push('missing-item')
  }
  if (ing.unit && !ing.amount) {
    issues.push('unit-without-amount')
  }
  if (ing.amount && !ing.unit) {
    issues.push('amount-without-unit')
  }

  return issues
}
```

Update SortableIngredientRow:

```tsx
const SortableIngredientRow = ({ ingredient, index, ... }) => {
  const issues = validateIngredient(ingredient)
  const hasIssues = issues.length > 0

  return (
    <div className={`... ${hasIssues ? 'ring-1 ring-amber-300' : ''}`}>
      {/* Existing inputs */}

      {/* Validation indicator */}
      {hasIssues && (
        <div className="absolute -top-1 -right-1">
          <AlertCircle className="h-4 w-4 text-amber-500 bg-background rounded-full" />
        </div>
      )}
    </div>
  )
}
```

Add "Auto-Fix" button for common issues:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={attemptAutoFix}
  className="text-xs"
>
  <Wand2 className="h-3 w-3 mr-1" />
  Fix Issues
</Button>

function attemptAutoFix() {
  const fixed = ingredients.map(ing => {
    const issues = validateIngredient(ing)

    // If item field contains parseable amount/unit, extract it
    if (issues.includes('missing-item') && ing.item.trim()) {
      const parsed = parseIngredientLine(ing.item)
      return {
        ...ing,
        amount: parsed.amount || ing.amount,
        unit: parsed.unit || ing.unit,
        item: parsed.item,
        modifier: parsed.modifier || ing.modifier,
      }
    }

    return ing
  })

  setIngredients(fixed)
}
```

### Verification

- Manual test: Add ingredient with only unit (no amount) → see warning indicator
- Click "Fix Issues" → verify it attempts to parse the item field
- Test with "2 cups flour" in item field → auto-fix extracts amount/unit

**Impact:** Reduces form submission errors. Helps users fix issues before saving.

---

## P4: Smart Ingredient Reordering

**Problem:** Manual drag-and-drop is tedious for long ingredient lists. Common patterns exist (proteins → vegetables → seasonings).

**Solution:** "Auto-Group" button that organizes ingredients by type.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/components/recipes/recipe-dialog.tsx:1116-1126`](web/src/components/recipes/recipe-dialog.tsx#L1116-L1126) | Add "Auto-Group" button in ingredients header |

### Implementation

```typescript
// Category classification
const INGREDIENT_CATEGORIES = {
  proteins: ['chicken', 'beef', 'pork', 'fish', 'turkey', 'lamb', 'tofu', 'egg'],
  vegetables: ['onion', 'garlic', 'carrot', 'celery', 'pepper', 'tomato', 'potato', 'broccoli', 'spinach', 'mushroom'],
  seasonings: ['salt', 'pepper', 'paprika', 'cumin', 'oregano', 'basil', 'thyme', 'cinnamon', 'nutmeg', 'bay leaf'],
  liquids: ['water', 'broth', 'stock', 'milk', 'cream', 'wine', 'oil', 'vinegar', 'sauce'],
  baking: ['flour', 'sugar', 'butter', 'yeast', 'baking powder', 'baking soda', 'vanilla'],
}

function classifyIngredient(item: string): string {
  const normalized = item.toLowerCase()

  for (const [category, keywords] of Object.entries(INGREDIENT_CATEGORIES)) {
    if (keywords.some(kw => normalized.includes(kw))) {
      return category
    }
  }

  return 'other'
}

function autoGroupIngredients(ingredients: Ingredient[]): Ingredient[] {
  const grouped = ingredients.map(ing => ({
    ...ing,
    _category: classifyIngredient(ing.item)
  }))

  const order = ['proteins', 'vegetables', 'baking', 'liquids', 'seasonings', 'other']

  return grouped.sort((a, b) => {
    const aIndex = order.indexOf(a._category)
    const bIndex = order.indexOf(b._category)
    return aIndex - bIndex
  }).map(({ _category, ...ing }) => ing)
}

// UI Button
<button
  type="button"
  onClick={() => setIngredients(autoGroupIngredients(ingredients))}
  className="text-xs font-bold text-muted-foreground hover:text-primary flex items-center gap-1"
>
  <Wand2 className="h-3.5 w-3.5" />
  AUTO-GROUP
</button>
```

### Verification

- Manual test: Create recipe with mixed ingredients → click Auto-Group → verify logical ordering
- Test edge cases: Unknown ingredients go to end, existing order preserved within groups

**Impact:** Minor QoL improvement. Helpful for long recipes (10+ ingredients).

---

## P5: Pre-Ingredient Adjective Extraction

**Problem:** "3 mashed overripe bananas" → "mashed" is a prep instruction but stays in item name.

**Challenge:** Distinguishing prep verbs from descriptive adjectives:
- ✅ "mashed bananas" → modifier: "mashed"
- ❌ "overripe bananas" → keep in item (describes state, not prep)
- ❌ "red onions" → keep in item (variety)

**Solution:** Extract only known prep verbs at the start of item name.

### Files to Modify

| File | Change |
|------|--------|
| [`web/src/lib/recipe-parser.ts:279-289`](web/src/lib/recipe-parser.ts#L279-L289) | Add `extractPrepAdjective()` before modifier extraction |

### Implementation

```typescript
/**
 * Extract preparation adjectives at the start of item name
 * Only extracts known prep verbs, not descriptive adjectives
 */
function extractPrepAdjective(item: string): {
  item: string;
  prepModifier?: string
} {
  const prepVerbs = /^(mashed|chopped|diced|minced|sliced|grated|shredded|crushed|julienned|ground)\s+/i

  const match = item.match(prepVerbs)
  if (match) {
    const prep = match[0].trim()
    const remaining = item.substring(match[0].length).trim()

    // Only extract if remaining text is substantial (not just "ed" or similar)
    if (remaining.length > 2) {
      return { item: remaining, prepModifier: prep }
    }
  }

  return { item }
}

// In parseIngredientLine:
const { item: baseItem, prepModifier } = extractPrepAdjective(item)
const { item: finalItem, modifier } = extractModifier(baseItem)

// Combine prep + existing modifier
const combinedModifier = [prepModifier, modifier].filter(Boolean).join(', ') || undefined

return {
  item: finalItem,
  amount,
  unit,
  modifier: combinedModifier,
  originalText,
}
```

### Keyword Curation

**Conservative approach:** Only include unambiguous prep verbs. Do NOT include:
- Size descriptors: large, small, medium (could be variety)
- State descriptors: ripe, fresh, dry (not prep instructions)
- Color adjectives: red, green, yellow (varieties)

**Safe verbs:** mashed, chopped, diced, minced, sliced, grated, shredded, crushed, julienned, ground, crumbled, torn

### Tests

```typescript
describe('pre-ingredient adjective extraction', () => {
  it('should extract prep verbs', () => {
    const result = parseIngredientLine('3 mashed overripe bananas')
    expect(result.item).toBe('overripe bananas')
    expect(result.modifier).toBe('mashed')
  })

  it('should not extract descriptive adjectives', () => {
    const result = parseIngredientLine('2 red onions')
    expect(result.item).toBe('red onions')
    expect(result.modifier).toBeUndefined()
  })

  it('should combine with comma-based modifiers', () => {
    const result = parseIngredientLine('2 chopped tomatoes, drained')
    expect(result.item).toBe('tomatoes')
    expect(result.modifier).toBe('chopped, drained')
  })
})
```

### Verification

- Unit tests pass
- Manual test: Import banana bread recipe → "mashed overripe bananas" parsed correctly
- Verify "red onions" stays unchanged

**Impact:** Captures additional 10-15% of modifier cases. Edge case improvement.

---

## Implementation Checklist

### Phase 1: Critical Fixes (Ship ASAP)
- [ ] P0: Mixed fraction fix
  - [ ] Update `normalizeUnicode()` function
  - [ ] Add/update tests
  - [ ] Verify with banana bread recipe

### Phase 2: High-Value UX (Next Sprint)
- [ ] P1: Live import preview
  - [ ] Add debounced parsing logic
  - [ ] Build two-column layout
  - [ ] Add preview panel UI
  - [ ] Test on mobile

### Phase 3: Enhanced Parsing (Nice-to-Have)
- [ ] P2: Alternative ingredients
  - [ ] Add `alternatives` field to type
  - [ ] Implement `extractAlternatives()`
  - [ ] Update UI renderers
  - [ ] Add tests

- [ ] P3: Validation indicators
  - [ ] Add validation helper
  - [ ] Add visual indicators
  - [ ] Build auto-fix logic

### Phase 4: Polish (If Time Permits)
- [ ] P4: Smart reordering
  - [ ] Build ingredient classifier
  - [ ] Add Auto-Group button

- [ ] P5: Prep adjectives
  - [ ] Implement `extractPrepAdjective()`
  - [ ] Curate keyword list
  - [ ] Add tests

---

## Success Metrics

**Phase 1 (P0):**
- All recipes with mixed fractions parse correctly
- Zero "10.75 cups" bugs reported

**Phase 2 (P1):**
- Users see preview within 300ms of typing
- Import completion rate increases (fewer abandoned imports)
- Time-to-first-import decreases

**Phase 3 (P2-P3):**
- Alternative ingredients captured in 15%+ of imports
- Form validation errors decrease by 50%

---

## Notes

- **Backward compatibility:** All type changes are optional fields → no migration needed
- **Progressive enhancement:** Each feature ships independently
- **Test coverage:** Every parser change has unit tests
- **Mobile-first:** Live preview layout must work on small screens (vertical stack)

---

## Future Considerations

Not in this plan, but worth noting:

1. **Bulk ingredient paste:** Detect multi-line paste in item field → auto-split into rows
2. **Ingredient autocomplete:** Common ingredients with typical amounts
3. **ML-based parsing:** Train model on recipe corpus for better extraction
4. **Recipe import from photos:** OCR + parsing (requires external API)
5. **Nutrition data extraction:** Parse from Schema.org or external API

---

**Document Location:** This plan should be moved to [`docs/plans/recipe-parser-improvements-2026-02.md`](docs/plans/) for reference.
