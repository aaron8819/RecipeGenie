import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument, validateShoppingDocumentV3 } from '../shopping-document';
import { initializeShoppingDocument, appendDocumentPurchases, readInitializedDocument } from '../shopping-initialization';
import { applyOrganization, inspectOrganization, moveInverse, organizationInverse, organizationVersion, type OrganizationAction } from '../shopping-organization';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';

function fixture() {
  return appendDocumentPurchases(initializeShoppingDocument(createEmptyShoppingDocument(), []), ['apple', 'banana', 'carrot', 'lemon']);
}
function apply(doc: ReturnType<typeof fixture>, action: OrganizationAction) {
  const result = applyOrganization(doc, inspectOrganization(doc, action));
  if (!('document' in result)) throw new Error(result.status);
  expect(readInitializedDocument(result.document, validateShoppingDocumentV3)).not.toBeNull();
  return result.document;
}
const move = (key: string, at: 'start' | 'end' = 'end', categoryKey = 'dairy'): OrganizationAction => ({ kind: 'move', key, destination: { categoryKey, at } });

describe('Slice 9 organization contract', () => {
  it('S59/S92/S93 splices only the chosen dormant key, including empty destinations', () => {
    let doc = fixture();
    doc = apply(doc, { kind: 'move', key: 'carrot', destination: { categoryKey: 'produce', at: 'before', anchor: 'banana', anchorVersion: 0 } });
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'carrot', 'banana', 'lemon']);
    doc = apply(doc, move('carrot', 'start'));
    expect(doc.preferences.ingredientOrderByCategory.dairy).toEqual(['carrot']);
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'banana', 'lemon']);
  });
  it('S64/S65 independent keys survive, same key and anchor changes conflict', () => {
    const before = fixture();
    const a = inspectOrganization(before, move('apple'));
    const b = inspectOrganization(before, move('banana'));
    const after = applyOrganization(before, a);
    if (!('document' in after)) throw new Error();
    expect(applyOrganization(after.document, b).status).toBe('Applied');
    expect(applyOrganization(after.document, a).status).toBe('Conflict');
    const anchored = inspectOrganization(before, { kind: 'move', key: 'carrot', destination: { categoryKey: 'produce', at: 'before', anchor: 'apple', anchorVersion: 0 } });
    expect(applyOrganization(after.document, anchored).status).toBe('Conflict');
    expect(organizationVersion(after.document, 'purchase:banana')).toBe(0);
  });
  it('S94 position/category/both resets keep placement/default and distinguish slots', () => {
    const original = fixture();
    let doc = apply(original, { kind: 'reset', keys: ['apple'], mode: 'position', bulk: false });
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['banana', 'carrot', 'lemon', 'apple']);
    expect(doc.preferences.categoryByIngredient.apple).toBeUndefined();
    doc = apply(doc, move('apple'));
    doc = apply(doc, { kind: 'reset', keys: ['apple'], mode: 'category', bulk: false });
    expect(doc.preferences.ingredientOrderByCategory.produce.at(-1)).toBe('apple');
    doc = apply(doc, { kind: 'reset', keys: ['apple', 'banana', 'carrot', 'lemon'], mode: 'both', bulk: true });
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'banana', 'carrot', 'lemon']);
    expect(doc.placementEvidence).toEqual(original.placementEvidence);
  });
  it('S62 category deletion transfers every dormant key in order, retains pinned defaults', () => {
    let doc = apply(fixture(), { kind: 'createCategory', id: 'market', name: 'Market' });
    doc = apply(doc, move('banana', 'end', 'custom_market'));
    doc = apply(doc, move('apple', 'end', 'custom_market'));
    const stale = inspectOrganization(doc, move('lemon', 'end', 'custom_market'));
    const defaults = structuredClone(doc.placementEvidence);
    doc = apply(doc, { kind: 'deleteCategory', key: 'custom_market', fallback: 'dairy' });
    expect(doc.preferences.ingredientOrderByCategory.dairy).toEqual(['banana', 'apple']);
    expect(doc.preferences.ingredientOrderByCategory.custom_market).toBeUndefined();
    expect(doc.placementEvidence).toEqual(defaults);
    expect(applyOrganization(doc, stale).status).toBe('Conflict');
  });
  it('S61 rename is harmless to purchase moves; rename ABA conflicts', () => {
    let doc = apply(fixture(), { kind: 'createCategory', id: 'market', name: 'Market' });
    const pending = inspectOrganization(doc, move('apple', 'end', 'custom_market'));
    const rename = inspectOrganization(doc, { kind: 'renameCategory', key: 'custom_market', name: 'Farm' });
    doc = apply(doc, rename.action);
    expect(applyOrganization(doc, pending).status).toBe('Applied');
    doc = apply(doc, { kind: 'renameCategory', key: 'custom_market', name: 'Market' });
    expect(applyOrganization(doc, rename).status).toBe('Conflict');
  });
  it('S67 inverse restores a meaningful anchor, preserves unrelated insertions, rejects later move', () => {
    const before = fixture();
    const inverse = moveInverse(before, 'apple')!;
    let doc = apply(before, move('apple'));
    const undo = inspectOrganization(doc, inverse);
    doc = apply(doc, move('carrot', 'end', 'frozen'));
    const restored = applyOrganization(doc, undo);
    expect(restored.status).toBe('Applied');
    if (!('document' in restored)) throw new Error();
    expect(restored.document.preferences.ingredientOrderByCategory.produce).toEqual(['apple', 'banana', 'lemon']);
    expect(restored.document.preferences.ingredientOrderByCategory.frozen).toEqual(['carrot']);
    doc = apply(doc, move('apple', 'end', 'misc'));
    expect(applyOrganization(doc, undo).status).toBe('Conflict');
  });
  it('S63 sections move independently and reset without changing purchase placement', () => {
    let doc = fixture();
    const before = structuredClone(doc.preferences.ingredientOrderByCategory);
    const first = inspectOrganization(doc, { kind: 'moveSection', key: 'produce', anchor: 'dairy', at: 'after' });
    const second = inspectOrganization(doc, { kind: 'moveSection', key: 'frozen', anchor: 'misc', at: 'after' });
    doc = apply(doc, first.action);
    const next = applyOrganization(doc, second);
    expect(next.status).toBe('Applied');
    doc = apply(doc, { kind: 'resetSections' });
    expect(doc.preferences.ingredientOrderByCategory).toEqual(before);
  });
  it('S62/S68 restores deletion and bulk reset through scoped relative inverses', () => {
    let doc = apply(fixture(), { kind: 'createCategory', id: 'market', name: 'Market' });
    doc = apply(doc, move('banana', 'end', 'custom_market'));
    doc = apply(doc, move('apple', 'end', 'custom_market'));
    const before = structuredClone(doc);
    const deletion: OrganizationAction = { kind: 'deleteCategory', key: 'custom_market', fallback: 'dairy' };
    const inverse = organizationInverse(doc, deletion)!;
    doc = apply(doc, deletion);
    const token = inspectOrganization(doc, inverse);
    const restored = applyOrganization(doc, token);
    if (!('document' in restored)) throw new Error(restored.status);
    expect(restored.document.preferences).toEqual({ ...before.preferences,
      ingredientOrderByCategory: { ...before.preferences.ingredientOrderByCategory, dairy: [] } });
    expect(applyOrganization(apply(doc, move('carrot')), token).status).toBe('Conflict');
    const reset: OrganizationAction = { kind: 'reset', keys: ['apple', 'banana', 'carrot', 'lemon'], mode: 'both', bulk: true };
    const undo = organizationInverse(before, reset)!;
    doc = apply(before, reset);
    doc = apply(doc, undo);
    expect(doc.preferences.categoryByIngredient).toEqual(before.preferences.categoryByIngredient);
    expect(doc.preferences.ingredientOrderByCategory.custom_market).toEqual(['banana', 'apple']);
    expect(doc.preferences.ingredientOrderByCategory.produce).toEqual(['carrot', 'lemon']);
  });
  it('S100 authoritative settings versions reject ABA but permit disjoint settings', () => {
    const doc = fixture();
    const ctx: ShoppingCommandContext = { status: 'Ready', row: { document: doc, content_revision: 1 }, dependencyRevision: '0', pantry: [], recipes: [], inverse: null, inverseRevision: null };
    const command = { protocol: 1 as const, observedRevision: 1, observedSettingVersion: 0, mutation: { type: 'setExclusion' as const, key: 'pepper', enabled: true } };
    const first = planShoppingCommand(ctx, command);
    expect(first.outcome).toBe('Applied');
    ctx.row = { document: first.document, content_revision: 2 };
    expect(planShoppingCommand(ctx, { ...command, mutation: { ...command.mutation, key: 'cumin' } }).outcome).toBe('Applied');
    const remove = planShoppingCommand(ctx, { ...command, observedSettingVersion: 1, mutation: { ...command.mutation, enabled: false } });
    ctx.row = { document: remove.document, content_revision: 3 };
    expect(planShoppingCommand(ctx, command).outcome).toBe('Conflict');
  });
});
