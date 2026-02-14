# Designing the optimal recipe management system

**The strongest recipe management system combines Paprika's recipe capture, Plan to Eat's meal planning, AnyList's collaborative lists, Cooklist's pantry tracking, and Eat This Much's AI planning — no existing app unifies all five well.** This gap represents a significant opportunity. After analyzing 15+ consumer and enterprise solutions, reviewing open-source implementations (Tandoor, Mealie, Grocy, KitchenOwl, RecipeSage), cataloging technical patterns, and documenting user pain points across Reddit, Hacker News, and App Store reviews, this report provides a complete architectural blueprint. The recommended system uses a PostgreSQL backbone with normalized food/unit entities, CRDT-based real-time sync for shared shopping lists, the `recipe-scrapers` library for web import, and a phased rollout prioritizing recipe capture and meal planning before pantry intelligence.

---

## 1. Executive summary and recommended architecture

The recipe management space is mature but fragmented. Users cobble together 2-3 apps because no single solution excels across all five core domains: recipe storage, meal planning, shopping lists, pantry tracking, and recipe discovery. **The #1 user complaint across all platforms is fragmented recipe collections** — bookmarks, screenshots, Pinterest saves, and physical cookbooks scattered with no single source of truth.

**Recommended architecture**: A FastAPI (Python) or Node.js backend with PostgreSQL, using normalized food and unit lookup tables shared across recipes, shopping lists, and pantry inventory. The `recipe-scrapers` Python library provides import from 611+ sites with Schema.org JSON-LD fallback. Flutter or React Native delivers cross-platform mobile with offline-first local SQLite storage. Yjs CRDTs power real-time collaborative shopping lists. Schema.org/Recipe serves as the canonical data interchange format.

**Three critical architectural decisions** that separate successful implementations from failures:

1. **Normalized food entities** — Tandoor and Mealie both use shared `foods` and `units` lookup tables that recipes, shopping lists, and pantry items all reference. This enables intelligent ingredient aggregation across recipes ("1 cup flour" + "2 cups flour" = "3 cups flour"), pantry-to-recipe matching, and consistent shopping list generation. Apps that treat ingredient strings as opaque text (storing "1 cup all-purpose flour" as a single string) cannot perform these operations.

2. **Preserve original text alongside parsed data** — Always store the raw imported ingredient string (`original_text`) alongside the parsed components (quantity, unit, food_id, note). This allows re-parsing with improved algorithms, debugging, and user editing while maintaining backward compatibility.

3. **UUID primary keys everywhere** — Essential for offline-first operation. Clients must generate IDs without server coordination, making auto-incrementing integers impossible for any entity that might be created offline.

---

## 2. Competitive landscape matrix

| App | Price | Platforms | URL Import | Meal Plan | Shopping List | Pantry | Scaling | Collaboration | Key Differentiator |
|-----|-------|-----------|------------|-----------|--------------|--------|---------|---------------|-------------------|
| **Paprika** | $5-$30 one-time per platform | iOS, Android, Mac, Win | ✅ Best-in-class browser | ✅ Calendar | ✅ Aisle-sorted | ✅ | ✅ | ❌ Limited | Gold-standard recipe clipping |
| **Plan to Eat** | $50/yr | iOS, Android, Web | ✅ Extension | ✅ Best drag-drop | ✅ Auto from plan | ❌ | ✅ | ✅ | Best meal planning calendar |
| **AnyList** | $10-$15/yr | iOS, Android, Web, Mac | ✅ | ✅ | ✅ Best real-time shared | ❌ | ✅ | ✅ Best family sharing | Superior collaborative lists |
| **Mealime** | Free / $3-$6/mo | iOS, Android, Web | ✅ Pro only | ✅ Curated | ✅ Aisle + delivery | ❌ | ✅ | ✅ | Fastest plan-to-plate; 30-min recipes |
| **Whisk/Samsung** | Free / $7/mo | iOS, Android, Web | ✅ Social media | ✅ | ✅ Retail integration | ✅ Pro | ✅ | ✅ | Samsung appliance integration |
| **Yummly** | Free / $3-$5/mo | iOS, Android, Web | ✅ | ✅ Basic | ✅ | ❌ | ❌ | ✅ Social | 2M+ recipes, AI recommendations |
| **BigOven** | Free / $3/mo | iOS, Android, Web | ✅ + paper OCR | ✅ Calendar | ✅ | ✅ Partial | ✅ | ✅ Community | "Use Up Leftovers" search |
| **Eat This Much** | Free / $5-$9/mo | All platforms | ✅ Custom | ✅ Best auto-gen | ✅ Aisle-sorted | ✅ | ✅ Auto | ❌ | AI macro-based meal planning |
| **Supercook** | Free | Web, iOS, Android | ❌ | ❌ | ❌ | ✅ Core feature | ❌ | ❌ | Ingredient-first recipe search |
| **MealBoard** | $13 one-time | iOS only | ✅ | ✅ | ✅ Price tracking | ✅ Auto-deduction | ✅ | ❌ | Best budget/cost tracking |
| **Copy Me That** | $1/mo or $65 lifetime | All platforms | ✅ Simplest | ✅ | ✅ | ❌ | ✅ Pro | ✅ | Most affordable recipe clipping |
| **Cooklist** | Free / $6/mo | iOS, Android | ✅ Social | ✅ AI | ✅ Smart (pantry-aware) | ✅ Best: loyalty cards + barcode + expiry | ❌ | ✅ | Auto pantry via grocery loyalty cards |
| **Prepear** | Free / $10/mo | iOS, Android, Web | ✅ | ✅ Multi-week | ✅ Walmart | ✅ | ✅ | ✅ | Blogger meal plans, Walmart integration |

**Critical competitive gaps** where the market is underserved: (1) No app combines excellent recipe capture with excellent pantry tracking and family collaboration. (2) Meal plan template rotation (4-6 week cycles) is the most requested unbuilt feature. (3) Real-time family sharing remains limited to AnyList's list-focused approach. (4) Cross-platform pricing frustrates Paprika users who pay separately per device.

---

## 3. Technical architecture recommendations

### Recommended database schema

The optimal schema follows the **Tandoor/Mealie pattern** of normalized food and unit entities, extended with Grocy's stock management and Mealie's label-based shopping organization. PostgreSQL is the clear choice: JSONB handles flexible nutrition data, trigram indexes enable fuzzy search, and UUID support is native.

**Core entity relationships:**

```
recipes ──┬── recipe_steps (ordered, with markdown text)
          └── recipe_ingredients ──┬── foods (normalized lookup)
                                   └── units (normalized lookup)

meal_plan_entries ── recipes
                  ── meal_plans (date ranges)

shopping_list_items ──┬── foods (same entity as recipe ingredients)
                      ├── units
                      ├── shopping_labels (aisle/section)
                      └── recipes (source tracking)

pantry_items ──┬── foods (same entity!)
               └── units
```

**The key insight is that `foods` is the shared nucleus.** When a recipe calls for "chicken breast," the shopping list references the same `food_id`, and the pantry tracks the same `food_id`. This single normalization layer enables: automatic shopping list deduction against pantry stock, "what can I make?" queries, and intelligent ingredient aggregation.

**Recommended schema fields for the `recipes` table**: id (UUID), user_id, group_id, name, slug, description, image_url, source_url, servings (text like "4 servings"), servings_qty (numeric for scaling math), prep_time (minutes), cook_time (minutes), total_time, cuisine, rating, nutrition_json (JSONB), date_added, last_made, is_public.

**Recommended schema for `recipe_ingredients`**: id, recipe_id (FK), step_id (FK, links ingredient to specific instruction step), food_id (FK to `foods`), unit_id (FK to `units`), quantity (numeric), note (preparation instructions like "finely chopped"), original_text (raw imported string), position (sort order), group_header (section labels like "For the sauce").

### Recipe parsing pipeline

A three-tier extraction strategy, proven by Tandoor and Mealie:

1. **Site-specific scrapers** — The `recipe-scrapers` Python library covers 611+ sites with custom CSS selectors for each. Returns title, ingredients list, instructions, times, nutrition, and image URL.
2. **Schema.org JSON-LD fallback** ("wild mode") — Parses `<script type="application/ld+json">` tags looking for `"@type": "Recipe"`. This covers the vast majority of food blogs thanks to WordPress SEO plugins (WP Recipe Maker, Tasty Recipes).
3. **LLM-based extraction** — For sites without structured data, Mealie integrates OpenAI to parse unstructured HTML into recipe components. This handles social media transcriptions, PDF cookbooks, and non-standard sites.

After extraction, **ingredient strings must be parsed** into structured components (quantity, unit, food name, preparation notes). The best open-source options are `strangetom/ingredient-parser` (Python, CRF-based, outputs structured `ParsedIngredient` objects with confidence scores) and the NYTimes `ingredient-phrase-tagger` (trained on 130K human-tagged examples). For production systems, a hybrid approach using rule-based parsing with LLM fallback for ambiguous cases achieves the highest accuracy.

### Offline-first sync architecture

All reads and writes target local SQLite/IndexedDB first. UI is never blocked by network state. Changes queue in an operation log and sync via WebSocket or HTTP when connectivity returns.

For shopping lists specifically, **Yjs CRDTs** (the most mature JavaScript CRDT library) provide automatic conflict resolution: a `Y.Map` with OR-Set semantics for items and LWW-Registers for checked/quantity state. If User A adds "milk" while User B removes it simultaneously, the add wins — the safest default for shopping lists. **Automerge** is an excellent alternative for JSON-document-style data.

For recipe and meal plan data, **Last-Writer-Wins per field** with Lamport timestamps is sufficient, since these are typically edited by one user at a time.

### Recommended tech stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | FastAPI (Python) | Type safety via Pydantic, async, direct access to `recipe-scrapers` and NLP parsing libraries |
| Database | PostgreSQL | JSONB, full-text + trigram search, UUID support, proven at scale |
| ORM | SQLAlchemy or Prisma | Type-safe migrations, strong schema management |
| Mobile | Flutter | Truly native cross-platform (KitchenOwl proves this pattern); single codebase for iOS + Android + Web |
| Web Frontend | Vue.js or React | Vue proven by Tandoor/Mealie; React has larger ecosystem |
| Recipe Import | `recipe-scrapers` | 611+ sites, Schema.org fallback, MIT license |
| Offline Sync | Yjs + SQLite | Yjs for CRDT shopping lists, SQLite for local persistence |
| Real-time | WebSocket | For collaborative shopping list sync |
| Search | PostgreSQL trigram + full-text | Mealie pattern: fuzzy matching without external search infrastructure |
| Auth | OIDC / OAuth2 | KitchenOwl pattern: supports external identity providers |

---

## 4. Workflow documentation

### Flow 1: Recipe import → storage

**User discovers recipe online → shares/clips to app → structured data extracted → user reviews and edits → recipe saved to library**

1. User taps Share (mobile) or clicks browser extension (desktop)
2. App receives URL, fetches HTML
3. Three-tier parser attempts extraction: site-specific → Schema.org JSON-LD → LLM fallback
4. **Live preview** displayed before saving (Mela's pattern — critical for trust)
5. Ingredient strings parsed into quantity + unit + food_id + note components
6. New `foods` entities created if ingredient names don't match existing normalized foods
7. User can edit any field, add tags, assign to categories
8. Recipe saved with `original_text` preserved for every ingredient
9. Cover image downloaded and stored locally for offline access

### Flow 2: Recipe → meal plan

**User browses recipe library → drags recipes onto calendar → configures servings → plan saved**

1. User opens meal planner (default: current week view, scrollable to future weeks)
2. Recipe sidebar shows saved recipes with search/filter
3. Drag recipe to day + meal slot (breakfast/lunch/dinner/snack)
4. Configure servings for this instance (default: recipe's original serving count)
5. Non-recipe entries supported: "Leftovers from Monday," "Eating out," notes
6. **Template save**: user can save entire week as reusable template with a name
7. **Template rotation**: apply saved templates on a recurring schedule
8. Auto-generation option: app suggests meals based on preferences, pantry, nutrition targets

### Flow 3: Meal plan → shopping list

**Meal plan finalized → auto-generate shopping list → deduplicate and aggregate → subtract pantry items → organize by aisle**

1. User selects date range and taps "Generate Shopping List"
2. System collects all `recipe_ingredients` from planned meals, scaled by configured servings
3. **Ingredient aggregation**: items sharing the same `food_id` and compatible `unit_id` are summed ("1 cup flour" + "2 cups flour" = "3 cups flour")
4. **Pantry deduction**: items where `pantry_items.quantity >= needed_quantity` for the same `food_id` are excluded or reduced
5. Each item tagged with source recipe(s) for context
6. Items auto-categorized by `shopping_label` (Produce, Dairy, Frozen, etc.)
7. User can manually add non-recipe items (paper towels, cleaning supplies)
8. List shared in real-time with household members via CRDT sync

### Flow 4: Shopping → pantry update

**User shops → checks off items → purchased items flow into pantry inventory**

1. At store, user opens shared shopping list sorted by aisle
2. Tapping an item marks it as checked (moves to "Completed" section)
3. Post-shopping: prompt to add purchased items to pantry (batch action)
4. Alternative entry methods: barcode scanning, receipt OCR (CozZo pattern), voice input
5. Expiration dates set per item (manual entry or estimated from food category)
6. Items tracked with approximate quantities (Full → Some → Low → Out)

### Flow 5: Pantry → recipe discovery

**Pantry inventory → "What can I make?" → recipes ranked by ingredient coverage → missing ingredients added to shopping list**

1. User taps "What can I make?"
2. System queries recipes where maximum ingredients match current pantry `food_ids`
3. Results ranked by **ingredient match percentage** (SuperCook algorithm)
4. "Missing 1 ingredient" filter shows near-matches
5. Items closest to expiration date boosted in ranking (waste reduction)
6. Missing ingredients added to shopping list with one tap

---

## 5. UX pattern library

### Recipe capture: support 5+ input methods

The dominant pattern across successful apps is **multi-modal capture** meeting users wherever they discover recipes. Required methods: (1) **browser extension/bookmarklet** (Paprika gold standard — one-click import strips ads and blog preambles), (2) **mobile share sheet** (from browser, TikTok, Instagram), (3) **OCR/photo capture** (physical cookbooks, handwritten cards — CookBook app praised for "the only free OCR tool that actually works"), (4) **manual entry** with progressive disclosure (essential fields visible, secondary fields expandable), (5) **bulk import** from competing apps (Paprika format, RecipeML, Schema.org JSON-LD).

**Critical UX rule**: always show an editable preview before saving. Mela's live preview builds trust by showing users exactly what will be stored.

### Meal planning: drag-and-drop calendar is the proven paradigm

Plan to Eat sets the standard: a scrollable recipe sidebar alongside a weekly/monthly calendar grid with meal slots. Drag recipes onto days. Support both weekly and monthly views (default to weekly). Include first-class "Leftovers" and "Eating out" entries that don't generate shopping list items. The most-requested unbuilt feature is **template rotation** — "a list of recipes which I rotate round every 4-6 weeks, which then creates a shopping list each week" (top-voted Hacker News comment).

For users overwhelmed by choices, offer **AI auto-generation** (Eat This Much pattern): set calorie/macro targets, dietary preferences, and time constraints, and the system generates a complete weekly plan where every element is swappable with one tap.

### Shopping lists: real-time sharing is table stakes

AnyList's real-time collaborative list is the benchmark. Any household member sees updates instantly as items are checked off in the store. **Auto-combining duplicate ingredients across recipes is the #1 "smart" feature users cite.** Show which recipe each ingredient belongs to — "if my wife gives me a list but I cannot find an item, I'll at least know what that item was intended for so I can substitute" (Hacker News user on Paprika).

### Pantry tracking: approximate beats exact

Most successful pantry apps use **approximate quantity categories** (plenty → some → low → out) rather than requiring exact weights. This dramatically reduces friction. Barcode scanning for packaged goods, receipt OCR for post-shopping bulk entry, and voice input for quick additions cover the primary input scenarios. **Expiration tracking with push notifications** is the most-requested pantry feature, but reliability is critical — wrong dates erode trust completely. Never auto-populate expiration from barcodes (these are batch-specific, not UPC-specific).

### Cook mode: keep the screen alive

"Using one's phone in the kitchen with cake batter on your hands is always a disaster." Cook mode must keep the screen awake, display large text, provide voice-controlled step progression ("next step," "repeat"), and support multiple simultaneous timers. This is consistently cited as a make-or-break feature.

### Top 5 anti-patterns to avoid

- **Requiring account creation before showing value** — let users try the core experience immediately
- **Not combining duplicate ingredients in shopping lists** — showing "flour" three times from three recipes is unacceptable
- **Single-user design with no sharing** — families cook together; ignoring this limits the addressable market
- **No data export/backup** — creates lock-in anxiety that drives users to competitors
- **Complex onboarding before first use** — users abandon apps requiring extensive setup

---

## 6. Challenge registry

### Ingredient parsing (Severity: CRITICAL)

Ingredient strings are extraordinarily varied: "1 (14.5 oz) can diced tomatoes, drained," "2-3 large eggs, beaten," "1½ cups shredded Colby Jack or Cheddar cheese." The NYTimes `ingredient-phrase-tagger` (CRF model trained on 130K tagged examples) pioneered this space. The modern `strangetom/ingredient-parser` library outputs structured objects with name, amount, preparation, and confidence scores. The academic FINER dataset (1.4M words, 182K sentences) enables training BERT-based models that outperform CRF approaches.

**Imprecise measurements** ("to taste," "a pinch," "a handful") have no standardized conversion. Best practice: tag as COMMENT fields, assign approximate values for nutrition calculations (pinch ≈ 1/16 tsp), and exclude from shopping list quantities.

**Regional naming** ("cilantro" vs "coriander," "eggplant" vs "aubergine") requires a food ontology mapping synonyms and regional variants to canonical identifiers. FoodOn ontology and the USDA FoodData Central database (400K+ items) serve as foundation layers.

### Recipe scaling (Severity: HIGH)

Baking is chemistry — leavening agents do not scale linearly. **Doubling yeast in a doubled recipe causes overfermentation and structural collapse.** King Arthur Baking recommends baker's percentages (all ingredients as percentage of flour weight) for reliable scaling. Salt and spices scale sub-linearly (doubling a recipe typically needs only 1.5-1.75× the original spice amounts). Eggs are discrete units that resist fractional scaling.

**Recommended solution**: categorize ingredients into scaling groups — (1) linear-scaling structural ingredients, (2) sub-linear seasonings/spices, (3) non-linear leaveners/yeast, (4) discrete-unit items. Apply different scaling factors per category. Display warnings when scaling >2× for baked goods. Show cooking time adjustments (doubling does not double cook time due to surface-to-volume ratio changes).

### Multi-user coordination (Severity: MEDIUM)

Concurrent shopping list editing is a distributed systems problem with proven solutions. **OR-Set CRDTs** (Observed-Remove Set) are ideal: each add operation gets a unique tag, removes only target observed tags, and simultaneous add+remove resolves to "add wins" — the safe default for shopping lists. PN-Counter CRDTs handle item quantities. Production implementations include Yjs and Automerge, used by Apple Notes, Figma, and League of Legends at scale (7.5M concurrent users).

Conflicting household dietary preferences (one vegan, one gluten-free, one nut-allergic) require constraint intersection. Find recipes satisfying all restrictions, or plan separate components. The Spoonacular food ontology understands hidden ingredients (anchovies in Worcestershire sauce make dishes non-vegetarian) — essential for allergen safety.

### Data portability (Severity: MEDIUM)

The recipe format landscape is fragmented: Schema.org/Recipe (JSON-LD), RecipeML (XML, 2000), MealMaster (.mmf), MasterCook (.mxp), Paprika (zip of compressed JSON). **Schema.org/Recipe is the only viable canonical format** — it's the web standard used by Google, all major food blogs, and most modern recipe apps. Build importers for legacy formats (RecipeML, Paprika, MealMaster) and always export to Schema.org JSON-LD plus human-readable HTML/PDF.

Recipe versioning is an underserved need. Users make dozens of iterations to perfect a recipe but lose modification history. An **event-sourced append-only log** (simpler than full Git) with diff visualization and named checkpoints ("Thanksgiving 2025 version") provides the right balance of power and usability.

### Nutrition calculation (Severity: MEDIUM-HIGH)

Matching ingredients to USDA FoodData Central entries requires fuzzy matching because "chicken breast" has entries for raw, cooked-roasted, cooked-fried, with skin, without skin — each with dramatically different nutritional values. **Cooking yield factors** (baking causes moisture loss, concentrating nutrients per gram) and **nutrient retention factors** (folate in eggs retains 75% after baking) must be applied. The USDA maintains a "Table of Nutrient Retention Factors" for this purpose.

For practical accuracy, use Spoonacular or Edamam APIs for automated recipe nutrition analysis, supplemented by USDA FoodData Central for individual ingredient lookup. Display confidence levels and allow manual override for unusual ingredients.

---

## 7. Feature prioritization framework

### Must-have (MVP)

- **Recipe import from URL** — the core value proposition; users come for this first
- **Manual recipe entry** — with structured ingredient fields (qty, unit, food, notes)
- **Recipe library** with search, tags, and categories
- **Meal planning calendar** — weekly drag-and-drop with meal slots
- **Shopping list generation** from meal plan with ingredient aggregation
- **Recipe scaling** — serving size adjustment with unit conversion
- **Cook mode** — screen-awake, large text, step-by-step progression
- **Cross-platform sync** — cloud-based, included in base price
- **Data export** — Schema.org JSON-LD and human-readable formats

### Should-have (v2)

- **Family sharing** — real-time collaborative shopping lists and shared meal plans
- **Pantry tracking** — barcode scanning, approximate quantities, expiration alerts
- **"What can I make?"** — ingredient-based reverse recipe search from pantry
- **Meal plan templates** — save and rotate weekly plans on cycles
- **Grocery delivery integration** — Instacart "Shop This Recipe" button
- **Nutrition information** — auto-calculated from USDA/Spoonacular/Edamam
- **Dietary filtering** — global preference toggles (vegan, gluten-free, nut-free)
- **Social media capture** — import recipes from TikTok, Instagram, YouTube via AI transcription

### Nice-to-have (v3+)

- **AI meal plan auto-generation** based on nutrition targets, pantry, and budget
- **Ingredient substitution engine** — dietary and availability-based suggestions
- **Cost tracking** — per-recipe and per-meal-plan budgeting
- **Waste reduction scoring** — gamified food waste reduction metrics
- **Voice assistant integration** — Alexa Skill for hands-free cooking
- **Smart home device integration** — oven/timer control via Alexa.Cooking Interface
- **Health app sync** — Apple HealthKit / Android Health Connect for nutrition logging
- **Recipe recommendation engine** — collaborative + content-based filtering
- **Flavor pairing suggestions** — based on shared chemical compound analysis
- **OCR cookbook scanning** — batch digitization of physical recipes

---

## 8. Integration strategy

### Tier 1: Launch integrations

| Service | Why | Cost | Effort |
|---------|-----|------|--------|
| **Schema.org Recipe (JSON-LD)** | Universal recipe data format; both read (import) and write (export) | Free | Low |
| **USDA FoodData Central API** | Free nutrition database foundation; 300K+ foods | Free | Low |
| **Spoonacular API** | Recipe search, nutrition analysis, substitutions, meal planning; 380K+ recipes | Free tier: 150 calls/day | Medium |
| **recipe-scrapers (Python)** | Recipe import from 611+ websites | Free (MIT) | Low |

### Tier 2: Post-launch high-impact

| Service | Why | Cost | Effort |
|---------|-----|------|--------|
| **Instacart Developer Platform** | "Shop This Recipe" button + **affiliate revenue (~3% per order)**; 85K+ stores | Free + affiliate income | Medium |
| **Edamam Nutrition Analysis API** | Superior NLP-based recipe nutrition analysis; multi-language | Free tier available; paid from $19/mo | Medium |
| **Apple HealthKit** | Bridge to entire iOS health ecosystem (MFP, Fitbit, Garmin, Cronometer) | Free framework | Medium |
| **Android Health Connect** | Bridge to Android health ecosystem (replacing deprecated Google Fit) | Free | Medium |
| **Amazon Alexa Skills Kit** | Voice-guided cooking on Echo Show; largest kitchen smart display install base | Free to develop and publish | High |

### Tier 3: Growth phase

| Service | Why | Cost | Effort |
|---------|-----|------|--------|
| **Kroger API** | Direct cart addition for Kroger-family stores (2,800+ stores in 35 states) | Free developer tier | Medium |
| **Open Food Facts** | Barcode scanning for packaged foods; 2.5M+ products worldwide | Free (open-source) | Low |
| **Apple Siri Shortcuts** | iOS hands-free cooking ("next step," timers, grocery list creation) | Free | Medium |

### Services to avoid

- **Walmart API**: No public consumer-facing grocery API; partnership-only
- **Amazon Fresh**: Completely closed ecosystem; no third-party integration
- **MyFitnessPal API**: Private, not accepting new developer access requests
- **Google Assistant Actions**: Deprecated June 2023; transitioning to Gemini
- **Nutritionix API**: Enterprise pricing starts at $1,850/month — prohibitive for most apps
- **Smart kitchen device APIs**: Market too fragmented; proprietary ecosystems with no public APIs

---

## 9. Data model specifications

### Recipe entity (complete)

```
Recipe {
  id: UUID (client-generated)
  user_id: UUID → Users
  group_id: UUID → Groups
  name: string (required)
  slug: string (unique, URL-safe)
  description: text
  image_url: text
  source_url: text (original if imported)
  servings: string ("4 servings", "1 loaf")
  servings_qty: decimal (numeric for scaling)
  prep_time: integer (minutes)
  cook_time: integer (minutes)
  total_time: integer (minutes)
  cuisine: string
  rating: decimal (0-5)
  difficulty: enum (easy, medium, hard)
  nutrition: JSONB {calories, protein, carbs, fat, fiber, sodium...}
  is_public: boolean
  date_added: timestamp
  last_made: timestamp
  created_at: timestamp
  updated_at: timestamp
}
```

### Ingredient entity (parsed)

```
RecipeIngredient {
  id: UUID
  recipe_id: UUID → Recipes
  step_id: UUID → RecipeSteps (nullable, links to specific instruction)
  food_id: UUID → Foods (normalized lookup)
  unit_id: UUID → Units (normalized lookup)
  quantity: decimal
  note: text ("finely chopped", "to taste")
  original_text: text (raw imported string, always preserved)
  is_food: boolean (false for section headers)
  disable_amount: boolean (for "to taste" items)
  position: integer (sort order)
  group_header: string ("For the sauce", "For the dough")
}
```

### Meal plan entry

```
MealPlanEntry {
  id: UUID
  meal_plan_id: UUID → MealPlans
  recipe_id: UUID → Recipes (nullable for non-recipe entries)
  date: date
  meal_type: enum (breakfast, lunch, dinner, snack)
  title: string (override or non-recipe entry like "Leftovers")
  servings: decimal
  position: integer
}
```

### Shopping list item

```
ShoppingListItem {
  id: UUID
  shopping_list_id: UUID → ShoppingLists
  food_id: UUID → Foods (same entity as recipe ingredients)
  unit_id: UUID → Units
  quantity: decimal
  note: text
  checked: boolean
  checked_at: timestamp
  position: integer
  label_id: UUID → ShoppingLabels (aisle/section)
  recipe_ids: UUID[] (source recipes for context)
  is_manual: boolean (user-added vs auto-generated)
  created_at: timestamp
}
```

### Pantry item

```
PantryItem {
  id: UUID
  group_id: UUID → Groups
  food_id: UUID → Foods (same normalized entity)
  quantity: decimal
  quantity_level: enum (plenty, some, low, out)
  unit_id: UUID → Units
  expiry_date: date
  location: string (fridge, freezer, pantry, spice rack)
  purchase_date: date
  barcode: string
  note: text
}
```

### Normalized lookup entities

```
Food {
  id: UUID
  group_id: UUID → Groups
  name: string ("all-purpose flour")
  name_normalized: string (lowercase, trimmed for matching)
  usda_fdc_id: integer (link to USDA FoodData Central)
  default_label_id: UUID → ShoppingLabels ("Baking" aisle)
  description: text
}

Unit {
  id: UUID
  group_id: UUID → Groups
  name: string ("cup", "tablespoon", "gram")
  abbreviation: string ("c", "tbsp", "g")
  type: enum (volume, weight, count, other)
  base_unit_id: UUID → Units (for conversion: 1 tbsp = base unit)
  conversion_factor: decimal (to base unit)
}
```

---

## 10. Implementation roadmap

### Phase 1: Foundation (Months 1-3)

**Goal**: Core recipe management that outperforms Paprika on recipe capture.

- PostgreSQL schema with normalized foods/units tables
- Recipe import via `recipe-scrapers` (611+ sites) with Schema.org fallback
- Manual recipe entry with structured ingredient fields
- Ingredient parsing via `strangetom/ingredient-parser`
- Recipe library with full-text search, tags, categories
- Recipe scaling with serving size adjustment
- Cook mode (screen-awake, large text, step progression)
- Cloud sync across devices (included, not per-platform)
- Schema.org JSON-LD import/export for data portability

### Phase 2: Planning (Months 4-6)

**Goal**: Best-in-class meal planning and shopping list generation.

- Drag-and-drop meal planning calendar (weekly + monthly views)
- Meal slots (breakfast, lunch, dinner, snack) with non-recipe entries
- Shopping list auto-generation with ingredient aggregation across recipes
- Shopping list aisle/section categorization
- Meal plan templates: save, name, and rotate on cycles
- Basic nutrition display per recipe (Spoonacular API integration)
- Dietary preference filters (global toggles)

### Phase 3: Collaboration (Months 7-9)

**Goal**: Family-ready with real-time shared experiences.

- Household/group system with shared recipe libraries
- Real-time collaborative shopping lists (Yjs CRDT-based)
- Shared meal plans with per-user dietary preference handling
- Instacart "Shop This Recipe" integration (+ affiliate revenue)
- Social media recipe capture (TikTok, Instagram, YouTube via AI)
- Apple HealthKit + Android Health Connect nutrition sync

### Phase 4: Intelligence (Months 10-12)

**Goal**: Pantry-aware system that reduces waste and decision fatigue.

- Pantry tracking with barcode scanning and receipt OCR
- Expiration date tracking with push notification alerts
- Shopping list pantry deduction (auto-exclude items in stock)
- "What can I make?" reverse recipe search from pantry contents
- Ingredient substitution suggestions (structured DB + LLM hybrid)
- AI meal plan auto-generation based on pantry, nutrition, and preferences
- Alexa Skill for voice-guided cooking on Echo Show
- Recipe versioning with modification history

---

## Conclusion: where the real opportunity lies

The recipe management market has a structural gap. **No existing app successfully closes the loop from pantry → recipe suggestion → meal plan → shopping list → pantry replenishment.** Paprika excels at capture but lacks collaboration. Plan to Eat nails planning but ignores pantry. Cooklist tracks inventory brilliantly but has weak recipe management. AnyList shares lists beautifully but barely manages recipes.

The winning system treats the **`Food` entity as the universal connector** — the same normalized food record that appears in a recipe ingredient also lives in the pantry, appears on the shopping list, and maps to a USDA nutrition entry. This single design decision enables every "smart" feature users request: ingredient aggregation, pantry deduction, waste-aware suggestions, and nutrition calculation.

Three non-obvious insights from this research deserve emphasis. First, **approximate pantry tracking beats exact tracking** — users won't weigh their flour after each use, but they will tap "low" when the bag feels light. Friction kills pantry apps. Second, **meal plan template rotation is the most requested feature nobody has built well** — the 4-6 week cycle that generates weekly shopping lists would immediately serve the largest underserved user segment. Third, **Instacart integration is both a feature and a business model** — the "Shop This Recipe" button generates affiliate revenue while solving a real user need, making it the rare integration that improves UX and economics simultaneously.

The technical risk is manageable. The `recipe-scrapers` library, Schema.org standard, USDA database, and CRDT libraries are all mature, well-documented, and proven in production. The primary execution risk is scope — the temptation to build all features at once. The phased roadmap above deliberately sequences features so each phase delivers standalone value while building toward the closed-loop system that no competitor has achieved.