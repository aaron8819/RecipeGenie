# Prototype-to-application capability map

Inspected against `origin/main` `8277eeeb06ee68d5c198f0fa9d6d781f9135bacc`, 2026-10-06. Paths below are relative to `web/src/`. This is a source audit, not a backend execution report. [Scope, sequence and acceptance](recipe-planner-integration-plan.md).

## Recipe

| Prototype interaction | Existing component / hook / command | Real persistence and integration requirement |
|---|---|---|
| Search, category/tags/favorites, sort/view, empty recovery | `components/recipes/recipe-list.tsx`; `hooks/use-recipes.ts` useRecipes; category/tag/history hooks; `lib/recipe-route-state.ts` | Owner-scoped recipe reads; tag RPC `filter_recipes_by_tags`; URL browse state and return scroll/focus. Preserve real filters and user settings beyond demo subset. |
| Card/open/back/detail from other surfaces | `recipe-card.tsx`, `recipe-detail-page.tsx`; useRecipe; `lib/recipe-detail-navigation.ts` | Canonical recipe UUID route and source/week-aware return; no prototype numeric/local IDs. |
| Grouped ingredients/instructions, quantities/prep/alternatives/As needed | RecipeDetailContent; canonical recipe structure and `lib/recipe-quantity.ts` | Preserve stored structure/order and quantity fidelity; no flattening or numeric inference from qualitative text. Existing editor remains source of truth. |
| Change servings | Detail selected yield; getScalingBasis, formatRecipeQuantity, assertRecipeScalingFeasible, selectedYieldRatio | View scaling does not update recipe. Validate integer yield 1–100 and feasible ratios; original metadata and quantities retained. |
| Selected ingredients/servings to Shopping, from card/detail | `components/shopping/shopping-selection-dialog.tsx`; `lib/shopping-selection.ts`; `hooks/shopping/use-shopping-document.ts` useAddToShoppingList | Existing selector restores saved yield/ordinals before default scale, warns on changed content. Hook rereads canonical rows, validates exact selection IDs/contentSnapshot, creates exact-scale entries; `executeShoppingCommand` mutation `upsertRecipes`. Recipe currently needs new selector entry-point wiring, not a new backend. |
| Favorite | useToggleFavorite in use-recipes | Owner recipe_uuid update with optimistic rollback/cache invalidation. Preserve disabled/pending states. |
| Mark made / undo made | Detail useMarkRecipeAsMade / useUnmarkRecipeAsMade (recipe history hooks) | Owner recipe_history insert/removal with invalidation. This global history action differs from Planner weekly cooked RPC. Add card callback only; do not invent plan coupling. |
| Add to plan | `components/recipes/add-to-plan-dialog.tsx` AddToPlanDialog; useAddRecipeToPlan in `hooks/use-planner.ts` | Real current/week-start configuration; optional day; duplicate checking and guarded plan persistence. Keep existing assignment semantics. |
| Edit/new/import/photo/discard | `components/recipes/recipe-dialog.tsx` and editor subcomponents; useCreateRecipe/useUpdateRecipe; existing import/storage paths | Canonical UUID write, owner recipe insert/update and existing validation/dirty guard. Preserve full editor features, upload cleanup and import review; prototype editor is not a substitute. |
| Share/inbox | ShareRecipeDialog/SharedInbox; recipe-share hooks; `/api/recipe-shares` and accept RPC | Real owner-authorized share snapshot and accept/decline flow; no simulated link or toast-only operation. Retain full inbox. |
| Delete | useDeleteRecipe → executeShoppingCommand `deleteRecipe` | Coordinated recipe/Shopping lifecycle, command recovery and confirmation; never replace with a direct table delete. |
| Print/export/settings | Detail `window.print`; downloadRecipesAsJson; existing settings/tag/category hooks | Print/download are client operations; user_config/category/tag changes are real writes. Card print placement requires explicit navigation/callback handling. Keep bulk category/tag behavior. |

## Planner

Slice 4/5 refinement and Dashboard dependency audit, 2026-10-07, are in the
[existing integration plan](recipe-planner-integration-plan.md#planner-slice-45-preparation--2026-10-07).
This audit remains based on `8277eee`; it does not establish the deployed SHA.
Template ownership shorthand below refers to SaveTemplateDialog and
LoadTemplateDialog plus `use-plan-templates.ts`, not a standalone PlanTemplates
component. Preserve their shared callers and data contracts.

| Prototype interaction | Existing component / hook / command | Real persistence and integration requirement |
|---|---|---|
| Previous/next/date/current week | `components/planner/meal-planner.tsx`; `lib/planner-route-state.ts`, planner-utils | Validated route dates, configured week start and calendar-day conversion; no frozen Monday assumptions. Keep mobile today/week filters and progress. |
| Add/search/filter/multiple meals | AddRecipeToPlanModal; useWeeklyPlan/useWeeklyPlanRecipes/usePlannerCategories/useAddRecipeToPlan | Reads owner recipes/current plan; duplicate UUID check; persistWeeklyPlanDirect owner upsert. Multiple different recipes/day supported; repeated instance of same recipe/week is not. |
| Empty/unassigned/day layout | `meal-planner.selectors.ts` groupRecipesByPlannerDay; buildUnassignedDayPriority/getUnassignedDayOfWeek | Unassigned entries are distributed into day buckets under current priorities. Dedicated Unassigned section is not existing behavior; a separate product decision is required. |
| Open details | MealPlanner meal card link → buildRecipeDetailHref | Shared canonical detail route with Planner week return. No duplicate local detail state. |
| Mark cooked/Undo | useMarkRecipeMade in use-planner | RPC `toggle_weekly_recipe_made` updates history and weekly made flags atomically; preserve date_made and local-noon/timezone handling. Not the global Recipe mark-made action. |
| Swap chooser / Surprise | SwapMealDialog; useReplacePlannedRecipe / replacePlannedRecipe in `hooks/use-replace-planned-recipe.ts` | RPC `replace_planned_recipe`; expected recipes/made flags/assignments/day and timezone, owner/cooked/duplicate checks, locked conflict rejection and reopen recovery. Explicit choice and same-category Surprise retain existing selection rules. Do not wire legacy useSwapRecipe. |
| Move / drag | handleMoveToDay + useSaveDayAssignments; existing PointerSensor | Only seven scheduled days accepted; converts view index to calendar weekday. Direct plan read/upsert with pending per-week overlay, rollback/invalidation. Preserve menu keyboard alternative and pointer behavior; no supported Move to Unassigned. |
| Remove/Undo | useRemoveRecipeFromPlan / existing add-back recovery | Removes plan UUID/assignment/made flag via direct write, not recipe deletion. Preserve existing recovery; no wholesale prototype snapshot restoration. |
| One meal/full week Shopping | Shared ShoppingSelectionDialog + useAddToShoppingList | Same `upsertRecipes` command path as Recipe; full week includes cooked recipes, per-meal UI disables cooked action. Preserve current distinction, scale/selection validation and source refresh. |
| Save/load/rename/delete templates | PlanTemplates, Save/LoadTemplateDialog; `hooks/use-plan-templates.ts`; useSaveWeeklyPlan | Owner plan_templates writes; load rereads recipes and filterTemplateLoadData, reports missing recipes, confirms replacement, writes real plan. Preserve existing saved assignments/selection. |
| Generate/settings | useGenerateMealPlan in use-planner; PlanSettingsModal/useUpdateUserConfig | Real owner recipe/history/config reads; retain cooked meals and made flags; generate remaining meals with history cutoff/categories/preferred/excluded days/auto-assignment; direct insert/update. Settings persist user_config. Do not copy deterministic demo generator. |
| Clear week | No control/command found in current MealPlanner | Unsupported prototype bulk action. Requires separately defined cooked/history/Undo/concurrency contract; omitted from visual integration. |

## Persistence/recovery boundary

Shopping commands POST `/api/shopping` through admission/context/commit transactions and receipt/revision handling. Preserve idempotency, unknown outcomes, touched-field conflicts, frozen source selections, quantities, manual extras, Pantry/exclusions, ordering and checked coverage. Recipe deletion uses this same boundary.

Planner add/move/remove/save/template/generation use existing owner-fenced read/write paths, including persistWeeklyPlanDirect canonical `recipe_uuids`, assignment and made UUID fields. They are not universally atomic compare-and-swap. Cooked toggle and replacement have dedicated RPC contracts. Do not strengthen guarantees in copy or simplify them in code; stronger concurrency needs separately reviewed backend work.

## Shared components and tests

Authenticated shell: `app/(authenticated)/layout.tsx`, `components/layout/desktop-sidebar.tsx`, `header.tsx`, `bottom-nav.tsx`. Keep auth, help, branding, PWA/navigation and 1024px breakpoint. Use existing Button/Dialog/Dropdown primitives and scoped styles.

Dashboard has its own cards in `components/dashboard/dashboard.tsx` and calls real Planner/history/replacement/Shopping owners. Shopping has its own list and canonical detail source links. Shared detail, selector and quantity changes require both surfaces' regression journeys. Recipe editor remains complete; do not move persistence into a new shared menu/controller.

Focused existing suites (relative to `web/`):

- Recipes: `src/components/recipes/__tests__/recipe-list.test.tsx`, `recipe-card.test.tsx`, `recipe-detail-page.test.tsx`, `recipe-detail-page-state.test.tsx`; editor helpers/components/image-flow and sortable-ingredients suites. `src/lib/__tests__/recipe-route-state.test.ts`, `recipe-detail-navigation.test.ts`, `recipe-quantity.test.ts`, `shopping-selection.test.ts`, ingredient-editor/data-validation/history/export suites.
- Planner: components/interactions/template-load/add/swap/save/load suites under `src/components/planner/__tests__/`; selectors/utils under `src/components/planner/tests/`; `src/hooks/__tests__/replace-planned-recipe.test.ts`, `use-planner-direct-writes.test.tsx`; planner route/date/generation helper suites.
- Authenticated browser: `tests/recipes.spec.ts`, `meal-planner.spec.ts`, recipe import/mobile import review, sharing authorization, edit-ingredients inspection, navigation/design corrections; existing Shopping protocol/operability/quantity/recovery and Dashboard Shopping contract coverage for shared changes.

Add only focused tests for changed entry points, precedence decisions and recovery. Pair browser screenshots with frozen prototype evidence; run Chromium/WebKit emulation at the three required sizes. Follow `tests/LOCAL_AUTH_BROWSER.md`, `tests/E2E_CREDENTIALS.md` and existing fixture/auth isolation guards; no secrets in reports and no production fallback.
