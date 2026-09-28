import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, validateShoppingDocumentV3 } from '../shopping-document';
import { initializeShoppingDocument, readInitializedDocument } from '../shopping-initialization';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { type ShoppingCommand } from '../shopping-command';
import { shoppingCompatibilityFixture } from '@/test/shopping-compatibility-fixtures';
import { shoppingContent } from '../shopping-clear';
import { restoredShoppingContent } from '../shopping-lifecycle';

const fixture = shoppingCompatibilityFixture();
const recipe = fixture.recipes[0];
const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' });
const key = entry.ingredients[0].purchaseKey;
const recipes = fixture.recipes.map(r => ({ ...r, recipe_uuid: r.id,
  ingredient_sections: r.ingredientSections, instruction_sections: r.instructionSections }));
function harness() {
  let document = initializeShoppingDocument(createEmptyShoppingDocument(), []), revision = 1;
  const context = (): ShoppingCommandContext => ({ status: 'Pending', row: { document, content_revision: revision },
    dependencyRevision: '0', pantry: [], recipes, inverse: null, inverseRevision: null });
  const command = (mutation: ShoppingCommand['mutation']): ShoppingCommand => ({ protocol: 1, observedRevision: revision, mutation });
  const run = (c: ShoppingCommand) => {
    const result = planShoppingCommand(context(), c);
    if (result.outcome === 'Applied') { document = result.document; revision++; }
    return result;
  };
  const apply = (mutation: ShoppingCommand['mutation']) => {
    const result = run(command(mutation)); expect(result.outcome).toBe('Applied'); return result;
  };
  return { command, run, apply, context, get document() { return document; } };
}
const add = { type: 'upsertRecipe' as const, entry };
const remove = { type: 'removeRecipe' as const, recipeId: recipe.id };
const hide = { type: 'setSuppressed' as const, aggregateKey: JSON.stringify(['purchase', key]), suppressed: true };
const manual = (id: string) => ({ type: 'addManualItem' as const, item: { id, displayName: key,
  quantity: { amount: 3, unit: 'count' }, categoryKey: 'produce', bucket: 'items' as const, checked: false } });

describe('trip purchase visibility', () => {
  it('an inherited visibility change fences a previously inspected manual editor', () => {
    const h = harness(); h.apply(add); h.apply(hide); h.apply(remove); h.apply(manual('a'));
    const stale = { ...h.command({ type: 'editManualItem', id: 'a', changes: { displayName: 'lemons' } }),
      observedManual: structuredClone(h.document.manualItems[0]) };
    h.apply({ type: 'setSuppressed', aggregateKey: JSON.stringify(['purchase', key]), suppressed: false });
    expect(h.run(stale).outcome).toBe('Conflict');
  });
  it('S09 retains dormant visibility across serialization, quantity changes and same-trip return', () => {
    const h = harness(); h.apply(add); h.apply(hide);
    const organization = structuredClone(h.document.preferences);
    h.apply(remove);
    const loaded = readInitializedDocument(JSON.parse(JSON.stringify(h.document)), validateShoppingDocumentV3)!;
    expect(loaded.tripVisibility?.[key]).toBe('excluded');
    expect(projectShoppingDocument(loaded).rows).toHaveLength(0);
    h.apply(add);
    expect(projectShoppingDocument(h.document).items.some(r => r.orderingKey === key)).toBe(false);
    expect(h.document.preferences).toEqual(organization);
  });
  it('S97 clears dormant visibility, restores only content, and retains a truly unchanged Clear', () => {
    const h = harness();
    expect(h.run(h.command({ type: 'complete' })).outcome).toBe('Unchanged');
    h.apply(add); h.apply(hide); h.apply(remove);
    const inverse = shoppingContent(h.document);
    h.apply({ type: 'complete' });
    expect(h.document.tripVisibility).toEqual({});
    expect(h.run(h.command({ type: 'complete' })).outcome).toBe('Unchanged');
    const moved = structuredClone(h.document);
    moved.preferences.categoryByIngredient[key] = 'pantry';
    const restored = restoredShoppingContent(moved, inverse);
    expect(restored.tripVisibility?.[key]).toBe('excluded');
    expect(restored.preferences).toEqual(moved.preferences);
    h.apply(add);
    expect(projectShoppingDocument(h.document).items.some(r => r.orderingKey === key)).toBe(true);
  });
  it('manual-only and recipe demand recover the same choice, including removed manual items', () => {
    const h = harness(); h.apply(add); h.apply(hide); h.apply(remove);
    h.apply(manual('a'));
    expect(projectShoppingDocument(h.document).items).toHaveLength(0);
    h.apply({ type: 'deleteManualItem', id: 'a' });
    h.apply({ type: 'restoreManualItem', id: 'a', expectedVersion: h.document.manualItems[0].identity!.version });
    expect(projectShoppingDocument(h.document).items).toHaveLength(0);
    h.apply({ type: 'setSuppressed', aggregateKey: JSON.stringify(['purchase', key]), suppressed: false });
    h.apply(add);
    expect(projectShoppingDocument(h.document).items.some(r => r.orderingKey === key)).toBe(true);
  });
  it('identity rebind leaves the old choice with the old purchase', () => {
    const h = harness(); h.apply(manual('a'));
    h.apply({ type: 'setSuppressed', aggregateKey: JSON.stringify(['purchase', key]), suppressed: true });
    h.apply({ type: 'rebindManualItem', id: 'a', expectedVersion: h.document.manualItems[0].identity!.version,
      displayName: 'apple', quantity: { amount: 1, unit: 'count' } });
    expect(projectShoppingDocument(h.document).items.map(r => r.orderingKey)).toEqual(['apple']);
    h.apply(add);
    expect(projectShoppingDocument(h.document).items.some(r => r.orderingKey === key)).toBe(false);
  });
  it('refuses Undo after later content and accepts the exact dormant inverse otherwise', () => {
    const h = harness(); h.apply(add); h.apply(hide); h.apply(remove);
    const inverse = shoppingContent(h.document); h.apply({ type: 'complete' });
    const c = h.context(); const revision = c.row!.content_revision;
    const context = { ...c, inverse, inverseRevision: revision, inverseTrip: 'trip', inverseEpoch: 9,
      row: { ...c.row!, trip_id: 'trip', content_epoch: 9 } };
    const undo: ShoppingCommand = { protocol: 1, observedRevision: revision, mutation: { type: 'undoClear' } };
    expect(planShoppingCommand(context, undo).document.tripVisibility).toEqual(inverse.tripVisibility);
    expect(planShoppingCommand({ ...context, row: { ...context.row, content_epoch: 10 } }, undo).outcome).toBe('UndoUnavailable');
  });
});
