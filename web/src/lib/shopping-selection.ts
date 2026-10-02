import type { Recipe } from '@/types/database';
import {
  createShoppingRecipeEntry,
  type ShoppingRecipeEntryV2,
} from './shopping-document';
import {
  assertRecipeScalingFeasible,
  getScalingBasis,
  selectedYieldRatio,
} from './recipe-quantity';
import { flattenRecipeIngredients } from './recipe-structure';

export interface ShoppingRecipeSelection {
  recipeId: string;
  selectedYield: number;
  ingredientOrdinals: number[];
  contentSnapshot: string;
}

// Canonicalize object keys because saved JSON and mapped recipes may differ in
// property order. Array order remains authoritative for source occurrences.
export function serializeShoppingSelection(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export function getShoppingRecipeSnapshot(recipe: Recipe): string {
  return serializeShoppingSelection({
    ingredientSections: recipe.ingredientSections,
    servings: recipe.servings,
    yieldMetadata: recipe.yield_metadata ?? null,
  });
}

export function createSelectedShoppingEntry(
  recipe: Recipe,
  selection: ShoppingRecipeSelection,
): ShoppingRecipeEntryV2 {
  if (
    selection.recipeId !== recipe.id ||
    selection.contentSnapshot !== getShoppingRecipeSnapshot(recipe)
  ) {
    throw new Error(
      `"${recipe.name}" changed. Close and reopen the selection to review its latest ingredients.`,
    );
  }
  const ingredients = flattenRecipeIngredients(recipe.ingredientSections);
  const ordinals = new Set(selection.ingredientOrdinals);
  if (
    !ordinals.size ||
    ordinals.size !== selection.ingredientOrdinals.length ||
    [...ordinals].some(
      (index) =>
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= ingredients.length,
    )
  ) {
    throw new Error(`Choose at least one ingredient for "${recipe.name}".`);
  }
  const basis = getScalingBasis(recipe.yield_metadata, recipe.servings);
  const ratio = selectedYieldRatio(selection.selectedYield, basis);
  assertRecipeScalingFeasible(
    ingredients.filter((_, index) => ordinals.has(index)),
    basis,
    selection.selectedYield,
  );
  // Filter source occurrences before resolving; packages/ranges retain their
  // original structured quantities and the central resolver owns semantics.
  let ordinal = 0;
  const selectedRecipe = {
    ...recipe,
    ingredientSections: recipe.ingredientSections.map((section) => ({
      ...section,
      ingredients: section.ingredients.filter(() => ordinals.has(ordinal++)),
    })),
  };
  return createShoppingRecipeEntry(
    selectedRecipe,
    (recipe.servings * selection.selectedYield) / basis,
    ratio,
  );
}

export function initialShoppingSelection(
  recipe: Recipe,
  saved?: ShoppingRecipeEntryV2,
  defaultScale = 1,
): { selection: ShoppingRecipeSelection; notice?: string } {
  const basis = getScalingBasis(recipe.yield_metadata, recipe.servings);
  const desiredYield =
    basis *
    (saved
      ? Number(saved.scaleV1.numerator) / Number(saved.scaleV1.denominator)
      : defaultScale);
  let selectedYield = desiredYield;
  let notice: string | undefined;
  try {
    selectedYieldRatio(selectedYield, basis);
  } catch {
    selectedYield = Math.min(basis, 100);
    notice =
      'The saved scale is outside supported yield limits. Review the new yield.';
  }
  const selection: ShoppingRecipeSelection = {
    recipeId: recipe.id,
    selectedYield,
    ingredientOrdinals: flattenRecipeIngredients(recipe.ingredientSections).map(
      (_, index) => index,
    ),
    contentSnapshot: getShoppingRecipeSnapshot(recipe),
  };
  if (!saved || notice) return { selection, notice };
  const full = createShoppingRecipeEntry(
    recipe,
    saved.selectedServings,
    saved.scaleV1,
  );
  if (
    serializeShoppingSelection(full.ingredients) ===
    serializeShoppingSelection(saved.ingredients)
  ) {
    return { selection };
  }
  if (saved.sourceEvidence?.history === 'captured') {
    const ordinals = saved.sourceEvidence.occurrences.map(source => source.ordinal);
    try {
      const recovered = { ...selection, ingredientOrdinals: ordinals };
      const expected = createSelectedShoppingEntry(recipe, recovered);
      if (serializeShoppingSelection(expected.ingredients) === serializeShoppingSelection(saved.ingredients) &&
        saved.sourceEvidence.sourceRevision === recipe.updated_at) return { selection: recovered };
    } catch { /* Changed sources use the explicit review fallback below. */ }
  }
  const matched: number[] = [];
  for (const ingredient of saved.ingredients) {
    const matches = full.ingredients.flatMap((candidate, index) =>
      serializeShoppingSelection(candidate) ===
      serializeShoppingSelection(ingredient)
        ? [index]
        : [],
    );
    if (matches.length !== 1 || matched.includes(matches[0])) {
      return {
        selection,
        notice:
          'Saved ingredients cannot be matched safely to this recipe. All ingredients are selected; review before updating Shopping.',
      };
    }
    matched.push(matches[0]);
  }
  if (!matched.length) {
    return {
      selection,
      notice:
        'The saved contribution is empty. Review a fresh ingredient selection.',
    };
  }
  return { selection: { ...selection, ingredientOrdinals: matched } };
}

/** Reconstruct commands from owner-scoped recipe inputs; never trust resolved ingredients. */
export function reconstructShoppingEntry(
  recipe: Recipe,
  entry: ShoppingRecipeEntryV2,
  selections?: ShoppingRecipeSelection[],
): ShoppingRecipeEntryV2 {
  if (!selections) return createShoppingRecipeEntry(recipe, entry.selectedServings, entry.scaleV1);
  const selection = selections.find(s => s.recipeId === recipe.id);
  if (!selection) throw new Error('Missing source selection.');
  return createSelectedShoppingEntry(recipe, selection);
}
