import { describe, expect, it } from 'vitest';
import { createEmptyShoppingDocument, projectShoppingDocument } from '../shopping-document';
import { initializeShoppingDocument, readInitializedDocument } from '../shopping-initialization';
import { validateShoppingDocumentV3 } from '../shopping-document';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { shoppingRowCoverage } from '../shopping-coverage-runtime';
import { compareShoppingCoverage } from '../shopping-coverage';
import { parseQuantityV1 } from '../recipe-quantity';
import type { ShoppingQuantity } from '@/types/database';
import { restoredShoppingContent } from '../shopping-lifecycle';

const initialized = () => initializeShoppingDocument(createEmptyShoppingDocument(), []);
function context(document = initialized()): ShoppingCommandContext {
  return { status: 'Pending', row: { document, content_revision: 8, trip_id: 'current', content_epoch: 4, trip_revision: 3 },
    dependencyRevision: '1', pantry: [], recipes: [], inverse: null, inverseRevision: null };
}
function basis(quantities: (ShoppingQuantity | null)[]) {
  return shoppingRowCoverage({ rowRef: 'derived:lemon', orderingKey: 'lemon', purchaseKeys: ['lemon'], displayName: 'lemon',
    bucket: 'items', checked: false, categoryKey: 'produce', categoryOrder: 0, quantity: null, sources: [],
    requirements: quantities.map(quantity => ({ quantity, bucket: 'items', displayName: 'lemon' })) });
}
const scalar = (amount: number, unit = 'count') => ({ amount, unit });
const exact = (text: string, unit = '') => ({ amount: null, unit, exactQuantityV1: parseQuantityV1(text) });

describe('Slice 8 runtime coverage and lifecycle contract', () => {
  it.each([
    [[scalar(2)], [scalar(5)], 'RequirementChanged'],
    [[scalar(5)], [scalar(3)], 'Covered'],
    [[scalar(2), scalar(3)], [scalar(4), scalar(1)], 'Covered'],
    [[exact('0.5', 'cup')], [exact('1/2', 'cup')], 'Covered'],
    [[scalar(1, 'cup')], [scalar(48, 'tsp')], 'Covered'],
    [[scalar(1.1)], [scalar(1.9)], 'RequirementChanged'],
    [[exact('1-2'), exact('1-2')], [exact('1-2')], 'Covered'],
    [[exact('1-3')], [exact('1-2')], 'RequirementChanged'],
    [[scalar(2, 'cup'), exact('as needed')], [scalar(2, 'cup')], 'Covered'],
    [[exact('as needed')], [exact('as needed'), exact('as needed')], 'RequirementChanged'],
    [[scalar(2), scalar(100, 'g')], [scalar(1), scalar(100, 'g')], 'Covered'],
    [[scalar(2), scalar(100, 'g')], [scalar(150, 'g')], 'RequirementChanged'],
    [[null], [null, null], 'RequirementChanged'],
  ] as [(ShoppingQuantity | null)[], (ShoppingQuantity | null)[], string][])('S77–S87: %j → %j', (saved, current, outcome) => {
    expect(compareShoppingCoverage(basis(saved), basis(current))).toBe(outcome);
  });
  it('S83 preserves package identity and count, without loose-content conversion', () => {
    const pack = (count: string, size: string): ShoppingQuantity => ({ ...exact(count, 'can'), exactPackageV1: {
      version: 1, count: parseQuantityV1(count), type: 'can', authoredType: 'can',
      size: { value: { numerator: size, denominator: '1' }, lexeme: size, unit: 'g', authoredUnit: 'g' },
    } });
    expect(compareShoppingCoverage(basis([pack('2', '400')]), basis([pack('1', '400')]))).toBe('Covered');
    expect(compareShoppingCoverage(basis([pack('2', '400')]), basis([pack('1', '800')]))).toBe('RequirementChanged');
    expect(compareShoppingCoverage(basis([pack('2', '400')]), basis([scalar(400, 'g')]))).toBe('RequirementChanged');
  });
  it('S98 rejects old-trip intent even if a refreshed cache supplied the current trip', () => {
    const c = context();
    const result = planShoppingCommand(c, { protocol: 1, observedRevision: 2, tripId: 'current', mutation: { type: 'complete' } });
    expect(result.outcome).toBe('TripEnded');
    expect(result.document).toEqual(c.row!.document);
  });
  it('S97 empty Clear is unchanged', () => {
    expect(planShoppingCommand(context(), { protocol: 1, observedRevision: 8, mutation: { type: 'complete' } }).outcome).toBe('Unchanged');
  });
  it('S101 refuses equal-looking content with a different epoch', () => {
    const c = context(); c.inverse = { recipeEntries: {}, manualItems: [], itemOverrides: {} };
    c.inverseRevision = 5; c.inverseTrip = 'current'; c.inverseEpoch = 2;
    expect(planShoppingCommand(c, { protocol: 1, observedRevision: 5, mutation: { type: 'undoClear' } }).outcome).toBe('UndoUnavailable');
  });
  it('S103 restoration keeps current placement and repairs a deleted legacy category', () => {
    const doc = initialized(); doc.preferences.categoryByIngredient.lemon = 'dairy';
    const inverse = { recipeEntries: {}, itemOverrides: {}, manualItems: [{ id: 'old', displayName: 'lemon',
      categoryKey: 'custom_deleted', quantity: null, checked: false, bucket: 'items' as const }] };
    const result = restoredShoppingContent(doc, inverse);
    expect(result.preferences).toBe(doc.preferences);
    expect(result.manualItems[0].categoryKey).toBe('misc');
    expect(doc.manualItems).toEqual([]);
  });
  it('coverage metadata validates and survives pure projection; malformed data refuses', () => {
    const doc = initialized(); doc.acknowledgements = { lemon: { version: 4, basis: basis([scalar(5)]) } };
    expect(readInitializedDocument(doc, validateShoppingDocumentV3)).toEqual(doc);
    projectShoppingDocument(doc, []);
    expect(doc.acknowledgements.lemon.version).toBe(4);
    expect(readInitializedDocument({ ...doc, acknowledgements: { lemon: { version: -1, basis: null } } }, validateShoppingDocumentV3)).toBeNull();
  });
});
