import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument } from '../shopping-document';
import { initializeShoppingDocument } from '../shopping-initialization';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { type ShoppingCommand } from '../shopping-command';
import { shoppingCompatibilityFixture } from '@/test/shopping-compatibility-fixtures';

const fixture = shoppingCompatibilityFixture();
const recipe = fixture.recipes[0];
const recipes = fixture.recipes.map(r => ({ ...r, recipe_uuid: r.id,
  ingredient_sections: r.ingredientSections, instruction_sections: r.instructionSections }));
function harness(initial = initializeShoppingDocument(createEmptyShoppingDocument(), [])) {
  let document = initial, revision = 1;
  const command = (mutation: ShoppingCommand['mutation']): ShoppingCommand => ({ protocol: 1, observedRevision: revision, mutation });
  const context = (): ShoppingCommandContext => ({ status: 'Pending', row: { document, content_revision: revision },
    dependencyRevision: '0', pantry: [], recipes, inverse: null, inverseRevision: null });
  const run = (c: ShoppingCommand) => {
    const result = planShoppingCommand(context(), c);
    if (result.outcome === 'Applied') { document = result.document; revision++; }
    return result;
  };
  const apply = (mutation: ShoppingCommand['mutation']) => {
    const result = run(command(mutation)); expect(result.outcome).toBe('Applied'); return result;
  };
  const select = (servings: number) => ({ type: 'upsertRecipe' as const,
    entry: createShoppingRecipeEntry(recipe, servings, { numerator: String(servings / 4), denominator: '1' }) });
  return { command, run, apply, select, get document() { return document; } };
}
const extra = { type: 'addManualItem' as const, item: { id: 'extra', displayName: 'lemon',
  quantity: { amount: 3, unit: 'count' }, categoryKey: 'produce', bucket: 'items' as const, checked: false } };

describe('Slice 7 independent review corrections', () => {
  it.each([4, 12])('F1 replacement at %s never accepts the previous selection token', servings => {
    const h = harness(); h.apply(h.select(4));
    const version = h.document.recipeEntries[recipe.id].sourceEvidence!.version;
    const stale = { ...h.command(h.select(8)), observedSelections: { [recipe.id]: version } };
    const removal = { ...h.command({ type: 'removeRecipe', recipeId: recipe.id }), observedSelections: { [recipe.id]: version } };
    h.apply({ type: 'removeRecipe', recipeId: recipe.id }); h.apply(h.select(servings));
    const replacement = structuredClone(h.document);
    expect(h.document.recipeEntries[recipe.id].sourceEvidence!.version).toBeGreaterThan(version);
    expect(h.run(stale).outcome).toBe('Conflict');
    expect(h.run(removal).outcome).toBe('Conflict');
    expect(h.document).toEqual(replacement);
    expect(h.run({ ...stale, observedRevision: h.command(h.select(8)).observedRevision }).outcome).toBe('Conflict');
    h.apply(h.select(8));
    expect(h.document.recipeEntries[recipe.id].selectedServings).toBe(8);
  });
  it.each(['suppressed', 'pantry', 'checked'] as const)('F3 removes the last source carrying %s overrides', kind => {
    const h = harness(); h.apply(h.select(4)); h.apply(extra);
    const key = h.document.recipeEntries[recipe.id].ingredients[0].aggregateKey;
    h.document.itemOverrides[key] = kind === 'suppressed' ? { suppressed: true } : kind === 'pantry' ? { bucket: 'already_have' } : { checked: true };
    const organization = structuredClone(h.document.preferences);
    const manual = structuredClone(h.document.manualItems);
    h.apply({ type: 'removeRecipe', recipeId: recipe.id });
    expect(h.document.recipeEntries).toEqual({}); expect(h.document.itemOverrides).toEqual({});
    expect(h.document.tripVisibility).toEqual(kind === 'checked' ? undefined : {
      [h.select(4).entry.ingredients[0].purchaseKey]: kind === 'suppressed' ? 'excluded' : 'already_have',
    });
    expect(h.document.manualItems).toEqual(manual); expect(h.document.preferences).toEqual(organization);
  });
  it('F4 bridge and return invalidate stale rebind even after bucket ABA', () => {
    const h = harness(); h.apply(extra);
    const stale = h.command({ type: 'rebindManualItem', id: 'extra', expectedVersion: 0, displayName: 'apple', quantity: extra.item.quantity });
    const rowRef = projectShoppingDocument(h.document).items[0].rowRef;
    h.apply({ type: 'pantry', rowRef });
    const hidden = structuredClone(h.document);
    expect(h.run(stale).outcome).toBe('Conflict'); expect(h.document).toEqual(hidden);
    h.apply({ type: 'editManualItem', id: 'extra', changes: { bucket: 'items' } });
    expect(h.run(stale).outcome).toBe('Conflict');
    h.apply({ ...stale.mutation, expectedVersion: h.document.manualItems[0].identity!.version } as ShoppingCommand['mutation']);
    expect(h.document.manualItems[0].identity!.purchaseKey).toBe('apple');
  });
  it.each([false, true])('F2 preserves displayed/manual order with partial metadata=%s', partial => {
    const legacy = createEmptyShoppingDocument();
    legacy.manualItems = ['zucchini', 'banana', 'apple'].map((displayName, i) => ({
      id: String(i), displayName, quantity: { amount: i + 1, unit: 'count' }, categoryKey: 'produce', bucket: 'items', checked: false,
    }));
    legacy.preferences.ingredientOrderByCategory = { produce: partial ? ['zucchini', 'hidden'] : ['zucchini', 'hidden', 'banana', 'apple'] };
    const before = projectShoppingDocument(legacy);
    const h = harness(legacy); h.apply({ type: 'initialize' });
    expect(projectShoppingDocument(h.document).items.map(r => r.displayName)).toEqual(before.items.map(r => r.displayName));
    expect(h.document.preferences.ingredientOrderByCategory.produce).toEqual(partial ? ['zucchini', 'hidden', 'apple', 'banana'] : ['zucchini', 'hidden', 'banana', 'apple']);
    expect(h.run(h.command({ type: 'initialize' })).outcome).toBe('Unchanged');
    expect(projectShoppingDocument(JSON.parse(JSON.stringify(h.document))).items).toEqual(projectShoppingDocument(h.document).items);
  });
  it('F2 preserves conflicting equivalent legacy placements without choosing a shared winner', () => {
    const legacy = createEmptyShoppingDocument();
    legacy.manualItems = ['zucchini', 'lemon', 'apple', 'lemon'].map((displayName, i) => ({
      id: String(i), displayName, quantity: { amount: i + 1, unit: 'count' }, categoryKey: i === 3 ? 'dairy' : 'produce', bucket: i === 3 ? 'already_have' : 'items', checked: false,
    }));
    legacy.preferences.ingredientOrderByCategory = { produce: ['zucchini', 'dormant', 'lemon', 'apple'] };
    legacy.preferences.categoryByIngredient = { lemon: 'dairy' };
    const before = projectShoppingDocument(legacy);
    const h = harness(legacy); h.apply({ type: 'initialize' });
    expect(h.document.placementEvidence!.unresolved.lemon.categories).toEqual(['produce', 'dairy']);
    expect(h.document.placementEvidence!.unresolved.lemon.sequences).toEqual(legacy.preferences.ingredientOrderByCategory);
    expect(h.document.placementEvidence!.defaults.lemon).toBeUndefined();
    expect(h.document.manualItems.map(i => i.identity!.legacy!.raw)).toEqual(legacy.manualItems);
    const saved = structuredClone(h.document);
    expect(projectShoppingDocument(h.document).rows.map(r => [r.rowRef, r.categoryKey])).toEqual(before.rows.map(r => [r.rowRef, r.categoryKey]));
    expect(h.document).toEqual(saved);
  });
  it('F2 keeps an unrecorded frozen recipe category separate from the new pinned default', () => {
    const legacy = createEmptyShoppingDocument();
    const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' });
    entry.ingredients.forEach(i => { i.defaultCategoryKey = 'dairy'; });
    legacy.recipeEntries[recipe.id] = entry;
    const h = harness(legacy); h.apply({ type: 'initialize' });
    expect(projectShoppingDocument(h.document).items.map(r => r.categoryKey)).toEqual(projectShoppingDocument(legacy).items.map(r => r.categoryKey));
    expect(h.document.preferences.categoryByIngredient.lemon).toBe('dairy');
    expect(h.document.placementEvidence!.defaults.lemon.categoryKey).toBe('produce');
    expect(h.document.recipeEntries[recipe.id].ingredients).toEqual(entry.ingredients);
  });
});
