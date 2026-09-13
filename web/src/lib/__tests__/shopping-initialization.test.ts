import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, type ShoppingDocumentV3 } from '../shopping-document';
import { readShoppingCompatibility } from '../shopping-compatibility';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { canonicalShoppingPayload, readShoppingCommand, type ShoppingCommand } from '../shopping-command';
import { initializeShoppingDocument, pinnedPurchaseDefault } from '../shopping-initialization';
import { sumShoppingRequirements } from '../shopping-extra-quantities';
import { shoppingCompatibilityFixture, ONE } from '@/test/shopping-compatibility-fixtures';
import { parseQuantityV1 } from '../recipe-quantity';
import { formatShoppingQuantityPart } from '../shopping-quantity-display';

const fixture = shoppingCompatibilityFixture();
const recipes = fixture.recipes.map(recipe => ({ ...recipe, recipe_uuid: recipe.id,
  ingredient_sections: recipe.ingredientSections, instruction_sections: recipe.instructionSections }));
const context = (document: ShoppingDocumentV3, revision = 1): ShoppingCommandContext => ({
  status: 'Pending', row: { document, content_revision: revision }, dependencyRevision: '0', pantry: [], recipes,
  inverse: null, inverseRevision: null,
});
const command = (mutation: ShoppingCommand['mutation'], revision = 1): ShoppingCommand => ({ protocol: 1, observedRevision: revision, mutation });
const initialized = () => initializeShoppingDocument(createEmptyShoppingDocument(), []);
const add = (id: string, name = 'lemon', amount = 3) => command({ type: 'addManualItem', item: {
  id, displayName: name, quantity: { amount, unit: 'count' }, categoryKey: 'dairy', checked: false, bucket: 'items',
} });
function apply(document: ShoppingDocumentV3, c: ShoppingCommand) {
  const result = planShoppingCommand(context(document, c.observedRevision), c);
  expect(['Applied', 'Unchanged']).toContain(result.outcome);
  expect(readShoppingCompatibility(result.document, 2).status).toBe('Supported');
  return result.document;
}
const recipeCommand = command({ type: 'upsertRecipe', entry: createShoppingRecipeEntry(fixture.recipes[0], 4, ONE) });

describe('Slice 7 command-owned initialization and quantities', () => {
  it('legacy derived amount overrides remain independent editable evidence', () => {
    const legacy = structuredClone(fixture.document);
    const key = legacy.recipeEntries[fixture.recipes[0].id].ingredients[0].aggregateKey;
    const override = { quantity: { amount: 7, unit: 'count' }, displayName: 'my lemons', checked: true };
    legacy.itemOverrides[key] = override;
    const doc = initializeShoppingDocument(legacy, []);
    expect(readShoppingCompatibility(doc, 1).status).toBe('Supported');
    const manual = doc.manualItems.find(item => item.id.startsWith('legacy-override:'))!;
    expect(manual.quantity).toEqual(override.quantity);
    expect(manual.identity!.legacy!.raw).toEqual({ aggregateKey: key, override });
    expect(projectShoppingDocument(doc).rows.find(row => row.manualId === manual.id)?.quantity?.amount).toBe(7);
    expect(doc.itemOverrides[key]).toEqual({ checked: true });
    expect(legacy.itemOverrides[key]).toEqual(override);
  });
  it('S94/S114 ambiguous placement requires a choice and archives every disputed sequence', () => {
    const legacy = structuredClone(fixture.document);
    legacy.preferences.ingredientOrderByCategory.dairy = ['lemon'];
    const doc = initializeShoppingDocument(legacy, []);
    expect(doc.placementEvidence!.unresolved.lemon.categories).toEqual(['produce', 'dairy']);
    const evidence = structuredClone(doc.placementEvidence!.unresolved.lemon);
    const resolved = apply(doc, command({ type: 'resolvePlacement', purchaseKey: 'lemon', categoryKey: 'produce', anchor: 'dormant' }));
    expect(resolved.preferences.ingredientOrderByCategory.produce).toEqual(['carrot', 'lemon', 'dormant', 'lime']);
    expect(resolved.placementEvidence!.resolved.lemon).toEqual(evidence);
    expect(resolved.placementEvidence!.unresolved.lemon).toBeUndefined();
  });
  it('S54/S57 existing move and reset keep hidden untouched pairs and the pinned default', () => {
    let doc = apply(apply(apply(initialized(), add('a', 'apple')), add('b', 'banana')), add('c', 'carrot'));
    doc = apply(doc, command({ type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { banana: 'misc' } } }));
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'carrot']);
    expect(doc.preferences.ingredientOrderByCategory.misc).toEqual(['banana']);
    doc = apply(doc, command({ type: 'updateCategoryPreferences', preferences: { categoryByIngredient: {} } }));
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'carrot', 'banana']);
    expect(doc.placementEvidence!.defaults.banana.categoryKey).toBe('produce');
  });
  it('S76 concurrent replacement rejects the stale captured selection version', () => {
    const doc = apply(initialized(), recipeCommand);
    const refreshed = apply(doc, command({ type: 'upsertRecipe', entry: createShoppingRecipeEntry(fixture.recipes[0], 8, { numerator: '2', denominator: '1' }) }));
    expect(planShoppingCommand(context(refreshed, 3), { ...recipeCommand, observedSelections: { [fixture.recipes[0].id]: 0 } }).outcome).toBe('Conflict');
  });
  it('S112/S116 preserves frozen sources, unknown categories, old checks and independent legacy amounts', () => {
    const before = structuredClone(fixture.document);
    const result = planShoppingCommand(context(before), command({ type: 'initialize' }));
    expect(result.outcome).toBe('Applied');
    expect(readShoppingCompatibility(result.document, 2).status).toBe('Supported');
    expect(before).toEqual(fixture.document);
    expect(result.document.recipeEntries[fixture.recipes[0].id].ingredients).toEqual(before.recipeEntries[fixture.recipes[0].id].ingredients);
    expect(result.document.manualItems[0].identity?.legacy?.raw).toEqual(before.manualItems[0]);
    const projection = projectShoppingDocument(result.document);
    expect(projection.rows.find(row => row.manualId === 'manual-extra')?.quantity?.amount).toBe(3);
    expect(projection.rows.some(row => row.manualId === 'unknown-category')).toBe(true);
    expect(result.document.preferences.ingredientOrderByCategory.produce).toEqual(['carrot', 'dormant', 'lemon', 'lime']);
  });
  it.each([true, false])('S14/S15 2 recipe + 3 extra = 5, manual first=%s', manualFirst => {
    const doc = manualFirst ? apply(apply(initialized(), add('extra')), recipeCommand) : apply(apply(initialized(), recipeCommand), add('extra'));
    const row = projectShoppingDocument(doc).items[0];
    expect(row.quantity?.amount).toBe(5);
    expect(row.requirements).toHaveLength(2);
    expect(row.categoryKey).toBe('produce');
    expect(doc.manualItems[0].quantity?.amount).toBe(3);
  });
  it('S76 replaces selected scale and unchanged source capture is a no-op', () => {
    const entry = createShoppingRecipeEntry(fixture.recipes[0], 8, { numerator: '2', denominator: '1' });
    const c = command({ type: 'upsertRecipe', entry });
    const doc = apply(initialized(), c);
    expect(projectShoppingDocument(doc).items[0].quantity?.amount).toBe(4);
    expect(planShoppingCommand(context(doc), c).outcome).toBe('Unchanged');
    expect(doc.recipeEntries[entry.recipeId].sourceEvidence?.history).toBe('captured');
    expect(doc.recipeEntries[entry.recipeId].sourceEvidence?.occurrences[0].raw).toEqual(fixture.recipes[0].ingredientSections[0].ingredients[0]);
  });
  it('S89/S90/S91 commits new slots once and appends a rebased independent addition', () => {
    let doc = apply(initialized(), add('b', 'banana'));
    doc = apply(doc, add('c', 'carrot'));
    const stale = planShoppingCommand(context(doc, 3), add('a', 'apple'));
    expect(stale.outcome).toBe('Applied');
    expect(stale.document.preferences.ingredientOrderByCategory.produce).toEqual(['banana', 'carrot', 'apple']);
    expect(projectShoppingDocument(stale.document).items.map(row => row.orderingKey)).toEqual(['banana', 'carrot', 'apple']);
    expect(projectShoppingDocument(stale.document).items).toEqual(projectShoppingDocument(stale.document).items);
  });
  it('S92 Clear and return keep the exact dormant slot', () => {
    let doc = apply(apply(initialized(), add('b', 'banana')), add('a', 'apple'));
    const saved = structuredClone(doc.preferences);
    doc = apply(doc, command({ type: 'complete' }));
    doc = apply(doc, add('returning', 'banana'));
    expect(doc.preferences).toEqual(saved);
  });
  it('S41 unrelated edits do not resolve a frozen manual identity again', () => {
    const doc = apply(initialized(), add('a'));
    doc.manualItems[0].displayName = 'new resolver would call this something else';
    const result = apply(doc, command({ type: 'editManualItem', id: 'a', changes: { quantity: { amount: 6, unit: 'count' } } }));
    expect(result.manualItems[0].identity?.purchaseKey).toBe('lemon');
    expect(projectShoppingDocument(result).items[0].orderingKey).toBe('lemon');
  });
  it('S19/S20 amount edits preserve identity; explicit rebind joins the target slot', () => {
    let doc = apply(apply(initialized(), add('a', 'yogurt')), add('b', 'lemon'));
    doc = apply(doc, command({ type: 'rebindManualItem', id: 'a', expectedVersion: 0, displayName: 'lemons', quantity: { amount: 2, unit: 'count' } }));
    expect(projectShoppingDocument(doc).items).toHaveLength(1);
    expect(projectShoppingDocument(doc).items[0].quantity?.amount).toBe(5);
    expect(doc.preferences.ingredientOrderByCategory.dairy).toContain('yogurt');
  });
  it('S112/S113 safe legacy edits remain independent and unrelated target commands work', () => {
    let doc = initializeShoppingDocument(fixture.document, []);
    const raw = structuredClone(doc.manualItems[0].identity?.legacy?.raw);
    doc = apply(doc, command({ type: 'editManualItem', id: 'manual-extra', changes: { quantity: { amount: 9, unit: 'count' } } }));
    doc = apply(doc, add('new-milk', 'milk'));
    expect(doc.manualItems[0].identity?.meaning).toBe('legacyIndependent');
    expect(doc.manualItems[0].identity?.legacy?.raw).toEqual(raw);
    expect(projectShoppingDocument(doc).rows.find(row => row.manualId === 'manual-extra')?.quantity?.amount).toBe(9);
    expect(projectShoppingDocument(doc).items.some(row => row.orderingKey === 'milk')).toBe(true);
  });
  it('S114 explicit extra resolution preserves evidence and rejects changed envelope versions', () => {
    const doc = initializeShoppingDocument(fixture.document, []);
    const c = command({ type: 'resolveLegacy', id: 'manual-extra', expectedVersion: 0, choice: 'extra', quantity: doc.manualItems[0].quantity,
      purchaseName: 'lemons', categoryKey: 'produce', anchor: null });
    const resolved = apply(doc, c);
    expect(projectShoppingDocument(resolved).items.find(row => row.orderingKey === 'lemon')?.quantity?.amount).toBe(6);
    expect(resolved.manualItems[0].identity?.conversion?.raw).toEqual(fixture.document.manualItems[0]);
    expect(planShoppingCommand(context(resolved), c).outcome).toBe('Conflict');
  });
  it('legacy deletion/Undo is conditional and never resurrects a changed version', () => {
    const doc = initializeShoppingDocument(fixture.document, []);
    const deleted = apply(doc, command({ type: 'deleteManualItem', id: 'manual-extra' }));
    expect(projectShoppingDocument(deleted).rows.some(row => row.manualId === 'manual-extra')).toBe(false);
    expect(planShoppingCommand(context(deleted), command({ type: 'restoreManualItem', id: 'manual-extra', expectedVersion: 0 })).outcome).toBe('Conflict');
    const restored = apply(deleted, command({ type: 'restoreManualItem', id: 'manual-extra', expectedVersion: 1 }));
    expect(restored.manualItems[0].identity?.legacy?.raw).toEqual(fixture.document.manualItems[0]);
  });
  it('S95 pins unknown defaults to Misc independent of source hints', () => {
    expect(pinnedPurchaseDefault('very unknown zzz purchase').categoryKey).toBe('misc');
    expect(pinnedPurchaseDefault('lemon').categoryKey).toBe('produce');
  });
  it('exact fractions, multiplicity, packages and unknown parts survive final formatting', () => {
    const third = { amount: 1 / 3, unit: 'cup', exactQuantityV1: parseQuantityV1('1/3') };
    const range = { amount: 1, unit: '', exactQuantityV1: parseQuantityV1('1–2') };
    const result = sumShoppingRequirements([third, third, range, range, null]);
    expect(result).toHaveLength(4);
    expect(result[0].amount).toBe(32); // exact teaspoons
    expect(result.map(formatShoppingQuantityPart).join(' + ')).toContain('1–2');
    expect(result[1]).toEqual(result[2]);
    expect(result[3].amount).toBeNull();
  });
  it('unsupported metadata is preserved and command structure rejects malformed choices', () => {
    const doc = initialized();
    const malformed = { ...doc, placementEvidence: null };
    const read = readShoppingCompatibility(malformed, 1);
    expect(read.status).toBe('Malformed');
    expect('original' in read && read.original).toBe(malformed);
    expect(readShoppingCommand(command({ type: 'restoreManualItem', id: 'a', expectedVersion: -1 }))).toBeNull();
    expect(canonicalShoppingPayload(doc)).toBe(canonicalShoppingPayload(structuredClone(doc)));
  });
});
