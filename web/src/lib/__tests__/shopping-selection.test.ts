import { describe, expect, it } from 'vitest';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { parseIngredientLine } from '@/lib/recipe-parser';
import { parseYieldMetadata } from '@/lib/recipe-quantity';
import {
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  applyShoppingDocumentMutation,
  projectShoppingDocument,
  validateShoppingDocumentV3,
} from '@/lib/shopping-document';
import {
  createSelectedShoppingEntry,
  initialShoppingSelection,
  getShoppingRecipeSnapshot,
} from '@/lib/shopping-selection';

const recipe = canonicalizeRecipeFixture({
  name: 'Soup',
  fixtureIngredients: [
    '1 cup milk',
    '2 tbsp olive oil',
    '1–2 (14 oz) cans tomatoes',
  ].map(parseIngredientLine),
});

describe('shopping source selection', () => {
  it('scales a subset and round-trips through the V3 validator', () => {
    const draft = initialShoppingSelection(recipe).selection;
    const entry = createSelectedShoppingEntry(recipe, {
      ...draft,
      selectedYield: 8,
      ingredientOrdinals: [0, 2],
    });
    expect(entry.ingredients).toHaveLength(2);
    expect(entry.scaleV1).toEqual({ numerator: '2', denominator: '1' });
    expect(entry.ingredients[0].quantity?.amount).toBe(2);
    expect(entry.ingredients[1].quantity?.exactPackageV1).toBeDefined();
    const document = createEmptyShoppingDocument();
    document.recipeEntries[recipe.id] = entry;
    const validation = validateShoppingDocumentV3(
      JSON.parse(JSON.stringify(document)),
    );
    expect(validation.ok).toBe(true);
  });

  it('uses authored yield instead of legacy servings for non-serving recipes', () => {
    const bread = { ...recipe, yield_metadata: parseYieldMetadata('2 loaves') };
    const selection = initialShoppingSelection(bread).selection;
    expect(selection.selectedYield).toBe(2);
    expect(
      createSelectedShoppingEntry(bread, { ...selection, selectedYield: 3 })
        .scaleV1,
    ).toEqual({ numerator: '3', denominator: '2' });
  });

  it('restores an unambiguous saved subset and its yield', () => {
    const entry = createSelectedShoppingEntry(recipe, {
      ...initialShoppingSelection(recipe).selection,
      selectedYield: 8,
      ingredientOrdinals: [1],
    });
    const recovered = initialShoppingSelection(
      recipe,
      JSON.parse(JSON.stringify(entry)),
      3,
    );
    expect(recovered.notice).toBeUndefined();
    expect(recovered.selection.selectedYield).toBe(8);
    expect(recovered.selection.ingredientOrdinals).toEqual([1]);
  });

  it('asks for fresh selection when quantities changed or duplicate sources are ambiguous', () => {
    const entry = createShoppingRecipeEntry(recipe, 4, {
      numerator: '1',
      denominator: '1',
    });
    const edited = {
      ...recipe,
      ingredientSections: [
        { label: null, ingredients: [parseIngredientLine('9 cups milk')] },
      ],
    };
    expect(initialShoppingSelection(edited, entry).notice).toContain(
      'cannot be matched safely',
    );
    const duplicate = canonicalizeRecipeFixture({
      fixtureIngredients: [
        parseIngredientLine('1 cup milk'),
        parseIngredientLine('1 cup milk'),
      ],
    });
    const partial = createSelectedShoppingEntry(duplicate, {
      ...initialShoppingSelection(duplicate).selection,
      ingredientOrdinals: [1],
    });
    expect(initialShoppingSelection(duplicate, partial).notice).toContain(
      'cannot be matched safely',
    );
  });

  it('rejects stale paths, empty selections, repeated paths, and invalid yields', () => {
    const draft = initialShoppingSelection(recipe).selection;
    expect(() =>
      createSelectedShoppingEntry({ ...recipe, servings: 6 }, draft),
    ).toThrow('changed');
    for (const ordinals of [[], [99], [0, 0], [-1]])
      expect(() =>
        createSelectedShoppingEntry(recipe, {
          ...draft,
          ingredientOrdinals: ordinals,
        }),
      ).toThrow('Choose at least');
    expect(() =>
      createSelectedShoppingEntry(recipe, { ...draft, selectedYield: 1.5 }),
    ).toThrow();
    expect(getShoppingRecipeSnapshot(recipe)).not.toBe(
      getShoppingRecipeSnapshot({
        ...recipe,
        ingredientSections: [...recipe.ingredientSections]
          .reverse()
          .map((s) => ({ ...s, ingredients: [...s.ingredients].reverse() })),
      }),
    );
  });

  it('replaces only this recipe contribution while preserving checks and other sources', () => {
    const other = { ...recipe, id: '00000000-0000-4000-8000-000000000002' };
    let state = { document: createEmptyShoppingDocument(), contentRevision: 0 };
    state = applyShoppingDocumentMutation(state, {
      type: 'upsertRecipes',
      entries: [recipe, other].map((r) =>
        createShoppingRecipeEntry(r, 4, { numerator: '1', denominator: '1' }),
      ),
    });
    const milk = projectShoppingDocument(state.document).items.find(
      (row) => row.displayName === 'milk',
    )!;
    state = applyShoppingDocumentMutation(state, {
      type: 'setChecked',
      rowRef: milk.rowRef,
      checked: true,
    });
    const entry = createSelectedShoppingEntry(recipe, {
      ...initialShoppingSelection(recipe).selection,
      selectedYield: 8,
      ingredientOrdinals: [0],
    });
    state = applyShoppingDocumentMutation(state, {
      type: 'upsertRecipes',
      entries: [entry],
    });
    const rows = projectShoppingDocument(state.document).items;
    expect(rows.find((row) => row.displayName === 'milk')).toMatchObject({
      checked: true,
      quantity: { amount: 3 },
    });
    expect(state.document.recipeEntries[other.id].ingredients).toHaveLength(3);
    const revision = state.contentRevision;
    expect(
      applyShoppingDocumentMutation(state, {
        type: 'upsertRecipes',
        entries: [entry],
      }).contentRevision,
    ).toBe(revision);
  });
});
