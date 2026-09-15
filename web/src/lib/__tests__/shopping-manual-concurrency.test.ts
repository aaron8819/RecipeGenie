import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument } from '../shopping-document';
import { initializeShoppingDocument } from '../shopping-initialization';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import type { ShoppingCommand } from '../shopping-command';

function harness() {
  let document = initializeShoppingDocument(createEmptyShoppingDocument(), []), revision = 1;
  const command = (mutation: ShoppingCommand['mutation']): ShoppingCommand => ({ protocol: 1, observedRevision: revision, mutation,
    observedManual: structuredClone(document.manualItems[0]) });
  const run = (c: ShoppingCommand) => {
    const context: ShoppingCommandContext = { status: 'Pending', row: { document, content_revision: revision },
      dependencyRevision: '0', pantry: [], recipes: [], inverse: null, inverseRevision: null };
    const result = planShoppingCommand(context, c);
    if (result.outcome === 'Applied') { document = result.document; revision++; }
    return result;
  };
  run(command({ type: 'addManualItem', item: { id: 'extra', displayName: 'lemon', quantity: { amount: 3, unit: 'count' },
    categoryKey: 'produce', bucket: 'items', checked: false } }));
  return { command, run, get document() { return document; } };
}

describe('manual independent-edit contract', () => {
  it.each([false, true])('disjoint edits commute, quantity first=%s', reverse => {
    const h = harness();
    const wording = h.command({ type: 'editManualItem', id: 'extra', changes: { displayName: 'lemons' } });
    const quantity = h.command({ type: 'editManualItem', id: 'extra', changes: { quantity: { amount: 4, unit: 'count' } } });
    const placement = structuredClone(h.document.preferences);
    for (const c of reverse ? [quantity, wording] : [wording, quantity]) expect(h.run(c).outcome).toBe('Applied');
    expect(h.document.manualItems[0]).toMatchObject({ displayName: 'lemons', quantity: { amount: 4, unit: 'count' }, identity: { version: 2 } });
    expect(h.document.preferences).toEqual(placement);
  });
  it.each(['displayName', 'quantity'] as const)('rejects competing %s and ABA without changing state', field => {
    const h = harness();
    const initial = structuredClone(h.document.manualItems[0]);
    const changes = field === 'displayName' ? { displayName: 'lemons' } : { quantity: { amount: 4, unit: 'count' } };
    const stale = h.command({ type: 'editManualItem', id: 'extra', changes });
    expect(h.run(stale).outcome).toBe('Applied');
    let before = structuredClone(h.document);
    expect(h.run(stale).outcome).toBe('Conflict');
    expect(h.document).toEqual(before);
    expect(h.run(h.command({ type: 'editManualItem', id: 'extra', changes: { [field]: initial[field] } })).outcome).toBe('Applied');
    before = structuredClone(h.document);
    expect(h.run(stale).outcome).toBe('Conflict');
    // A fresh document revision cannot rebind an old editor's field tokens.
    expect(h.run({ ...stale, observedRevision: h.command(stale.mutation).observedRevision }).outcome).toBe('Conflict');
    expect(h.document).toEqual(before);
  });
  it.each(['bucket', 'remove', 'rebind'] as const)('retains %s ABA fences', transition => {
    const h = harness();
    const stale = h.command({ type: 'editManualItem', id: 'extra', changes: { displayName: 'lemons' } });
    const apply = (mutation: ShoppingCommand['mutation']) => expect(h.run(h.command(mutation)).outcome).toBe('Applied');
    if (transition === 'bucket') {
      apply({ type: 'editManualItem', id: 'extra', changes: { bucket: 'already_have' } });
      apply({ type: 'editManualItem', id: 'extra', changes: { bucket: 'items' } });
    } else if (transition === 'remove') {
      apply({ type: 'deleteManualItem', id: 'extra' });
      apply({ type: 'restoreManualItem', id: 'extra', expectedVersion: 1 });
    } else {
      apply({ type: 'rebindManualItem', id: 'extra', displayName: 'apple', quantity: { amount: 3, unit: 'count' }, expectedVersion: 0 });
      apply({ type: 'rebindManualItem', id: 'extra', displayName: 'lemon', quantity: { amount: 3, unit: 'count' }, expectedVersion: 1 });
    }
    const before = structuredClone(h.document);
    expect(h.run(stale).outcome).toBe('Conflict'); expect(h.document).toEqual(before);
  });
  it('rejects identity-changing wording, preserves explicit clears and omitted fields', () => {
    const h = harness();
    const before = structuredClone(h.document);
    expect(h.run(h.command({ type: 'editManualItem', id: 'extra', changes: { displayName: 'frozen lemon' } })).outcome).toBe('Conflict');
    expect(h.document).toEqual(before);
    const wording = h.command({ type: 'editManualItem', id: 'extra', changes: { displayName: 'lemons' } });
    expect(h.run(h.command({ type: 'editManualItem', id: 'extra', changes: { quantity: null } })).outcome).toBe('Applied');
    expect(h.run(wording).outcome).toBe('Applied');
    expect(h.document.manualItems[0]).toMatchObject({ displayName: 'lemons', quantity: null, identity: { meaning: 'reminder' } });
    expect(h.run(h.command({ type: 'editManualItem', id: 'extra', changes: {} })).outcome).toBe('Unchanged');
  });
});
