import { describe, expect, it } from 'vitest';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, type ShoppingDocumentV3 } from '../shopping-document';
import { readShoppingCompatibility } from '../shopping-compatibility';
import { initializeShoppingDocument } from '../shopping-initialization';
import { planShoppingCommand } from '../shopping-command-planner';
import { shoppingDocumentToList } from '../shopping-view';
import { shoppingRowCoverage } from '../shopping-coverage-runtime';
import { parseIngredientLine } from '../recipe-parser';
import { formatShoppingPurchaseAmount, shoppingPurchaseDisplayName } from '../shopping-quantity-display';

const recipe = (line: string, id = '00000000-0000-4000-8000-000000000001') =>
  canonicalizeRecipeFixture({ id, name: line, fixtureIngredients: [parseIngredientLine(line)] });

function capture(document: ShoppingDocumentV3, recipes: ReturnType<typeof recipe>[], scale = 1) {
  const result = planShoppingCommand({ status: 'Pending', row: { document, content_revision: 1 },
    dependencyRevision: '0', pantry: [], inverse: null, inverseRevision: null,
    recipes: recipes.map(r => ({ ...r, recipe_uuid: r.id, ingredient_sections: r.ingredientSections, instruction_sections: r.instructionSections })),
  }, { protocol: 1, observedRevision: 1, mutation: { type: 'upsertRecipes',
    entries: recipes.map(r => createShoppingRecipeEntry(r, 4 * scale, { numerator: String(scale), denominator: '1' })) } });
  expect(result.outcome).toBe('Applied');
  return result.document;
}

const empty = () => initializeShoppingDocument(createEmptyShoppingDocument(), []);
const list = (document: ShoppingDocumentV3) => shoppingDocumentToList('user-1', { document, contentRevision: 2 });

describe('As needed whole produce purchase estimates', () => {
  it.each(['As needed onion', 'onion'])('preserves %s, estimating only the purchase', line => {
    const r = recipe(line);
    const original = structuredClone(r);
    const doc = capture(empty(), [r]);
    expect(r).toEqual(original);
    expect(doc.recipeEntries[r.id].sourceEvidence?.occurrences[0].raw).toEqual(r.ingredientSections[0].ingredients[0]);
    expect(doc.recipeEntries[r.id].ingredients[0].quantity).toMatchObject({ amount: null, exactQuantityV1: { kind: 'qualitative', authored: 'As needed' } });
    const item = list(doc).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('1');
    expect(shoppingPurchaseDisplayName(item)).toBe('onion (estimate)');
    expect(item.sources?.[0]).toMatchObject({ originalAmount: null, exactQuantityV1: { authored: 'As needed' } });
    expect(shoppingRowCoverage(projectShoppingDocument(doc).items[0]).parts[0].kind).toBe('token');
  });

  it('sums two counted onions and one stable estimate across reload and yield changes', () => {
    const needed = recipe('As needed onion');
    const counted = recipe('2 onions', '00000000-0000-4000-8000-000000000002');
    const doc = capture(empty(), [needed, counted]);
    const restored = readShoppingCompatibility(JSON.parse(JSON.stringify(doc)), 2);
    expect(restored.status).toBe('Supported');
    if (restored.status !== 'Supported') throw new Error('Invalid round trip');
    expect(restored.state.document).toEqual(JSON.parse(JSON.stringify(doc)));
    const item = list(restored.state.document).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('3');
    expect(shoppingPurchaseDisplayName(item)).toBe('onions (estimate)');
    expect(item.sources?.map(s => s.originalAmount)).toEqual([null, 2]);
    for (const scale of [2, 3]) {
      const scaled = capture(restored.state.document, [needed], scale);
      expect(formatShoppingPurchaseAmount(list(scaled).items[0])).toBe('3');
      expect(scaled.recipeEntries[needed.id].ingredients[0].quantity?.exactQuantityV1).toEqual(doc.recipeEntries[needed.id].ingredients[0].quantity?.exactQuantityV1);
      expect(scaled.recipeEntries[needed.id].sourceEvidence?.occurrences).toEqual(doc.recipeEntries[needed.id].sourceEvidence?.occurrences);
      expect(shoppingRowCoverage(projectShoppingDocument(scaled).items[0])).toEqual(shoppingRowCoverage(projectShoppingDocument(doc).items[0]));
    }
  });

  it.each(['salt', 'oil', 'basil', 'sauce', 'broccoli', 'garlic', 'onion powder', 'lime juice'])('does not fabricate purchases for as needed %s', name => {
    const doc = capture(empty(), [recipe(`As needed ${name}`)]);
    const item = list(doc).items[0] ?? list(doc).excluded[0];
    expect(item.amount).toBeNull();
    expect(formatShoppingPurchaseAmount(item)).toBe('');
    expect(shoppingPurchaseDisplayName(item)).not.toContain('estimate');
    expect(item.sources?.[0].exactQuantityV1).toMatchObject({kind:'qualitative',authored:'As needed'});
  });

  it.each(['salt', 'oil', 'basil', 'sauce'])('retains the missing quantity source for structured %s recipes', name => {
    const r = canonicalizeRecipeFixture({ fixtureIngredients: [{ item: name, amount: null, unit: '', originalText: `As needed ${name}` }] });
    const item = list(capture(empty(), [r])).items[0];
    expect(item.sources?.[0]).toMatchObject({ originalAmount:null, exactQuantityV1:{kind:'qualitative',authored:'As needed'} });
    expect(formatShoppingPurchaseAmount(item)).toBe('');
  });

  it.each(['lemon', 'lime'])('supports the existing whole %s default', name => {
    const item = list(capture(empty(), [recipe(`As needed ${name}`)])).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('1');
    expect(shoppingPurchaseDisplayName(item)).toBe(`${name} (estimate)`);
  });

  it.each(['juice of lime', 'zest of lemon', 'juice and zest of lime'])('preserves missing whole-citrus demand for %s', line => {
    const item = list(capture(empty(), [recipe(line)], 3)).items[0];
    expect(item.sources?.[0]).toMatchObject({ originalAmount:null, exactQuantityV1:{kind:'qualitative',authored:'As needed'} });
    expect(formatShoppingPurchaseAmount(item)).toBe('1');
    expect(shoppingPurchaseDisplayName(item)).toContain('(estimate)');
  });

  it('keeps counts authored within whole-citrus syntax', () => {
    const item = list(capture(empty(), [recipe('juice of 2 limes')])).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('2');
    expect(shoppingPurchaseDisplayName(item)).toBe('limes');
    expect(item.sources?.[0].originalAmount).toBe(2);
  });

  it.each(['onion to taste', 'onion for garnish'])('does not estimate other qualitative demand: %s', line => {
    const item = list(capture(empty(), [recipe(line)])).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('');
    expect(shoppingPurchaseDisplayName(item)).not.toContain('estimate');
  });

  it('keeps counted yield scaling exact', () => {
    const item = list(capture(empty(), [recipe('2 onions')], 3)).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe('6');
    expect(item.sources?.[0].originalAmount).toBe(6);
    expect(shoppingPurchaseDisplayName(item)).toBe('onions');
  });

  it.each([['2 onions', '2'], ['6 eggs', '6'], ['4 carrots', '4'], ['3 cups broccoli', ''], ['2 lb beef', '2 lb']])('preserves counted/display contract for %s', (line, amount) => {
    const item = list(capture(empty(), [recipe(line)])).items[0];
    expect(formatShoppingPurchaseAmount(item)).toBe(amount);
    expect(shoppingPurchaseDisplayName(item)).not.toContain('estimate');
  });
});
