import { describe, expect, it } from 'vitest';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import type { PantryItem, Recipe } from '@/types/database';
import { parseIngredientLine } from '../recipe-parser';
import {
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  projectShoppingDocument,
  validateShoppingDocumentV3,
} from '../shopping-document';
import { readShoppingCompatibility } from '../shopping-compatibility';
import { initializeShoppingDocument } from '../shopping-initialization';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import {
  createSelectedShoppingEntry,
  initialShoppingSelection,
  isShoppingIngredientOptional,
  shoppingSelectionReasons,
} from '../shopping-selection';

const pantry: PantryItem[] = [
  { id: 'pantry-onion', user_id: 'owner', item: 'onion', created_at: '' },
];
const recipe = canonicalizeRecipeFixture({
  name: 'Review Soup',
  ingredientSections: [
    {
      label: 'Soup',
      ingredients: [
        '1 onion',
        '1 red onion',
        '1 tsp kosher salt',
        '1 tsp garlic salt',
        '1 tsp black pepper',
        '1 bell pepper',
        '1 cup cilantro, optional',
        '1 cup basil',
      ].map(parseIngredientLine),
    },
    { label: 'Optional Garnish', ingredients: [parseIngredientLine('1 cup parsley')] },
  ],
});
function row(source: Recipe): unknown {
  return {
    ...source,
    recipe_uuid: source.id,
    ingredient_sections: source.ingredientSections,
    instruction_sections: source.instructionSections,
    yield_metadata: source.yield_metadata ?? null,
  };
}
function configured() {
  const document = createEmptyShoppingDocument();
  document.preferences.excludeSaltVariants = true;
  document.preferences.excludeBlackPepperVariants = true;
  document.preferences.excludedIngredientKeys = ['basil'];
  return document;
}

describe('shopping review defaults and canonical boundaries', () => {
  it('defaults explicit optional, Pantry and exclusion matches off without fuzzy families', () => {
    const document = configured();
    const reasons = shoppingSelectionReasons(recipe, document, pantry);
    expect(reasons).toEqual([
      ['In pantry'],
      [],
      ['Excluded'],
      [],
      ['Excluded'],
      [],
      ['Optional'],
      ['Excluded'],
      ['Optional'],
    ]);
    const selection = initialShoppingSelection(recipe, undefined, 1, reasons).selection;
    expect(selection.ingredientOrdinals).toEqual([1, 3, 5]);
    expect(createSelectedShoppingEntry(recipe, selection).ingredients).toHaveLength(3);
  });

  it.each([
    ['Optional Garnish', undefined, true],
    ['Herbs (optional)', undefined, true],
    [null, 'chopped, optional', true],
    [null, '(optional)', true],
    ['Garnish', 'for serving', false],
    ['Not optional', undefined, false],
    ['Optionality', 'optionally chopped', false],
    [null, 'not optional', false],
  ] as [string | null, string | undefined, boolean][])(
    'uses explicit optional markers %s / %s',
    (label, modifier, expected) => {
      expect(isShoppingIngredientOptional(label, modifier)).toBe(expected);
    },
  );

  it('preserves a deliberate saved optional/Pantry/excluded subset on reopening', () => {
    const selection = {
      ...initialShoppingSelection(recipe).selection,
      ingredientOrdinals: [0, 6, 7, 8],
      selectedYield: 8,
    };
    const saved = createSelectedShoppingEntry(recipe, selection);
    const recovered = initialShoppingSelection(
      recipe,
      saved,
      1,
      shoppingSelectionReasons(recipe, configured(), pantry),
    );
    expect(recovered.selection.ingredientOrdinals).toEqual([0, 6, 7, 8]);
    expect(recovered.selection.selectedYield).toBe(8);
  });

  it('uses fresh defaults with a notice when changed sources cannot recover saved choices', () => {
    const saved = createSelectedShoppingEntry(recipe, initialShoppingSelection(recipe).selection);
    const changed = {
      ...recipe,
      ingredientSections: [
        { label: 'Optional Garnish', ingredients: [parseIngredientLine('2 cups parsley')] },
      ],
    };
    const recovered = initialShoppingSelection(
      changed,
      saved,
      1,
      shoppingSelectionReasons(changed, configured(), pantry),
    );
    expect(recovered.notice).toContain('cannot be matched safely');
    expect(recovered.selection.ingredientOrdinals).toEqual([]);
  });

  it('keeps alternatives within the canonical resolver rather than matching substrings', () => {
    const alternatives = canonicalizeRecipeFixture({
      fixtureIngredients: [
        { item: 'milk', amount: 1, unit: 'cup', alternatives: ['oat milk'] },
        { item: 'oat milk powder', amount: 1, unit: 'cup' },
      ],
    });
    const owned: PantryItem[] = [{ ...pantry[0], item: 'oat milk' }];
    expect(shoppingSelectionReasons(alternatives, createEmptyShoppingDocument(), owned)).toEqual([
      ['In pantry'],
      [],
    ]);
  });
});

describe.each([3, 4])('reviewed shopping command persistence V%s', (version) => {
  it('manual inclusion reaches buyable aggregated rows without changing preferences or other sources', () => {
    const other = canonicalizeRecipeFixture({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Other Soup',
      fixtureIngredients: [parseIngredientLine('1 onion')],
    });
    let document = configured();
    document.recipeEntries[other.id] = createShoppingRecipeEntry(other, 4, {
      numerator: '1',
      denominator: '1',
    });
    if (version === 4) document = initializeShoppingDocument(document, []);
    const previous = structuredClone(document);
    const selection = {
      ...initialShoppingSelection(recipe).selection,
      selectedYield: 8,
      ingredientOrdinals: [0, 2, 6, 7, 8],
    };
    const entry = createSelectedShoppingEntry(recipe, selection);
    const context: ShoppingCommandContext = {
      status: 'Pending',
      row: { document, content_revision: 3 },
      dependencyRevision: '0',
      pantry,
      recipes: [row(recipe), row(other)],
      inverse: null,
      inverseRevision: null,
    };
    const result = planShoppingCommand(context, {
      protocol: 1,
      observedRevision: 3,
      mutation: { type: 'upsertRecipes', entries: [entry] },
      sourceSelections: [selection],
    });
    expect(result.outcome).toBe('Applied');
    expect(document).toEqual(previous);
    const persisted = JSON.parse(JSON.stringify(result.document));
    expect(readShoppingCompatibility(persisted, 4).status).toBe('Supported');
    expect(persisted.preferences.excludedIngredientKeys).toEqual(
      previous.preferences.excludedIngredientKeys,
    );
    expect(persisted.preferences.excludeSaltVariants).toBe(true);
    expect(persisted.preferences.excludeBlackPepperVariants).toBe(true);
    expect(persisted.recipeEntries[other.id]).toEqual(previous.recipeEntries[other.id]);
    const projection = projectShoppingDocument(persisted, pantry);
    expect(projection.items.map((item) => item.orderingKey)).toEqual(
      expect.arrayContaining(['onion', 'kosher salt', 'cilantro', 'basil', 'parsley']),
    );
    expect(projection.alreadyHave).toHaveLength(0);
    expect(projection.excluded).toHaveLength(0);
    expect(projection.items.find((item) => item.orderingKey === 'onion')?.sources).toHaveLength(2);
    if (version === 4) {
      const recovered = initialShoppingSelection(
        recipe,
        persisted.recipeEntries[recipe.id],
        1,
        shoppingSelectionReasons(recipe, persisted, pantry),
      );
      expect(recovered.selection.ingredientOrdinals).toEqual(selection.ingredientOrdinals);
    }
    const repeated = planShoppingCommand(
      { ...context, row: { document: persisted, content_revision: 4 } },
      {
        protocol: 1,
        observedRevision: 4,
        mutation: { type: 'upsertRecipes', entries: [entry] },
        sourceSelections: [selection],
      },
    );
    expect(repeated.outcome).toBe('Unchanged');
    expect(repeated.document).toEqual(persisted);
  });

  it('retains default filtering for callers without an explicit reviewed selection', () => {
    const document = version === 4 ? initializeShoppingDocument(configured(), []) : configured();
    const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' });
    const result = planShoppingCommand(
      {
        status: 'Pending',
        row: { document, content_revision: 0 },
        dependencyRevision: '0',
        pantry,
        recipes: [row(recipe)],
        inverse: null,
        inverseRevision: null,
      },
      { protocol: 1, observedRevision: 0, mutation: { type: 'upsertRecipes', entries: [entry] } },
    );
    expect(result.outcome).toBe('Applied');
    const projection = projectShoppingDocument(result.document, pantry);
    expect(projection.alreadyHave.some((item) => item.orderingKey === 'onion')).toBe(true);
    expect(projection.excluded.some((item) => item.orderingKey === 'basil')).toBe(true);
    expect(result.document.preferences.excludedIngredientKeys).toEqual(
      document.preferences.excludedIngredientKeys,
    );
    expect(result.document.preferences.excludeSaltVariants).toBe(true);
    expect(result.document.preferences.excludeBlackPepperVariants).toBe(true);
  });
});

it('explicit review includes a merged V4 manual extra and advances its guard consistently', () => {
  let document = initializeShoppingDocument(configured(), []);
  const context = (): ShoppingCommandContext => ({
    status: 'Pending',
    row: { document, content_revision: 0 },
    dependencyRevision: '0',
    pantry,
    recipes: [row(recipe)],
    inverse: null,
    inverseRevision: null,
  });
  const added = planShoppingCommand(context(), {
    protocol: 1,
    observedRevision: 0,
    mutation: {
      type: 'addManualItem',
      item: {
        id: 'extra',
        displayName: 'onion',
        quantity: { amount: 1, unit: '' },
        categoryKey: 'produce',
        bucket: 'items',
        checked: false,
      },
    },
  });
  expect(added.outcome).toBe('Applied');
  document = added.document;
  const hidden = planShoppingCommand(context(), {
    protocol: 1,
    observedRevision: 0,
    mutation: {
      type: 'setBucketOverride',
      aggregateKey: JSON.stringify(['purchase', 'onion']),
      bucket: 'already_have',
    },
  });
  expect(hidden.outcome).toBe('Applied');
  document = hidden.document;
  const previousManual = structuredClone(document.manualItems[0]);
  const selection = { ...initialShoppingSelection(recipe).selection, ingredientOrdinals: [0] };
  const included = planShoppingCommand(context(), {
    protocol: 1,
    observedRevision: 0,
    mutation: { type: 'upsertRecipes', entries: [createSelectedShoppingEntry(recipe, selection)] },
    sourceSelections: [selection],
  });
  expect(included.outcome).toBe('Applied');
  const manual = included.document.manualItems[0];
  expect(manual.bucket).toBe('items');
  expect(manual.quantity).toEqual(previousManual.quantity);
  expect(manual.identity!.version).toBe(previousManual.identity!.version + 1);
  expect(manual.identity!.fieldVersions!.guard).toBe(
    previousManual.identity!.fieldVersions!.guard + 1,
  );
  expect(projectShoppingDocument(included.document, pantry).items[0].requirements).toHaveLength(2);
  expect(included.document.preferences.excludedIngredientKeys).toEqual(['basil']);
});
