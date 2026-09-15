import { describe, expect, it } from 'vitest';
import { shoppingMaterialKey, shoppingRowCoverage } from '../shopping-coverage-runtime';
import { compareShoppingCoverage } from '../shopping-coverage';
import { sumShoppingRequirements } from '../shopping-extra-quantities';
import { parseQuantityV1 } from '../recipe-quantity';
import type { ShoppingQuantity } from '@/types/database';

const quantity = (amount: number, unit = 'cup'): ShoppingQuantity => ({ amount, unit });
function basis(parts: { quantity: ShoppingQuantity; alternatives?: string[] }[]) {
  return shoppingRowCoverage({ rowRef: 'derived:yogurt', orderingKey: 'yogurt', purchaseKeys: ['yogurt'],
    displayName: 'yogurt', quantity: null, bucket: 'items', checked: false, sources: [], categoryKey: 'dairy', categoryOrder: 0,
    requirements: parts.map(part => ({ ...part, displayName: 'source', bucket: 'items',
      materialKey: shoppingMaterialKey('yogurt', part.alternatives) })) });
}
const pack = (count: number, size: number): ShoppingQuantity => ({ amount: count, unit: 'can', exactPackageV1: {
  version: 1, type: 'can', authoredType: 'can', count: parseQuantityV1(String(count)),
  size: { value: { numerator: String(size), denominator: '1' }, lexeme: String(size), unit: 'g', authoredUnit: 'g' },
} });

describe('coverage corrections', () => {
  it.each([
    [['sour cream'], [], 'RequirementChanged'],
    [[], ['sour cream'], 'RequirementChanged'],
    [['sour cream'], ['cream cheese'], 'RequirementChanged'],
    [['sour cream', 'cream cheese'], ['cream cheese', 'sour cream', 'sour cream'], 'Covered'],
    [['yogurt'], [], 'Covered'],
  ] as [string[], string[], string][])('alternative constraints %j → %j', (before, after, expected) => {
    expect(compareShoppingCoverage(basis([{ quantity: quantity(2), alternatives: before }]),
      basis([{ quantity: quantity(2), alternatives: after }]))).toBe(expected);
  });
  it('does not borrow scalar totals from different alternative constraints or manual extras', () => {
    const before = basis([{ quantity: quantity(2), alternatives: ['sour cream'] }, { quantity: quantity(3) }]);
    expect(compareShoppingCoverage(before, basis([{ quantity: quantity(4) }]))).toBe('RequirementChanged');
    expect(compareShoppingCoverage(before, basis([{ quantity: quantity(3) }]))).toBe('Covered');
  });
  it.each([
    [[quantity(2, 'can')], [quantity(2, 'cans')], 'Covered'],
    [[quantity(2, 'can')], [quantity(1, 'can')], 'RequirementChanged'],
    [[quantity(2, 'can')], [quantity(3, 'can')], 'RequirementChanged'],
    [[quantity(2, 'can')], [quantity(2, 'jar')], 'RequirementChanged'],
    [[quantity(2, 'can'), quantity(2, 'can')], [quantity(2, 'can')], 'Covered'],
    [[quantity(2, 'can')], [quantity(1, 'can'), quantity(1, 'can')], 'RequirementChanged'],
    [[pack(2, 400)], [pack(1, 400)], 'Covered'],
    [[pack(2, 400)], [quantity(2, 'can')], 'RequirementChanged'],
    [[quantity(2, 'can')], [pack(2, 400)], 'RequirementChanged'],
    [[quantity(2, 'can'), quantity(3)], [quantity(2, 'can'), quantity(2)], 'Covered'],
  ] as [ShoppingQuantity[], ShoppingQuantity[], string][])('package constraints %j → %j', (before, after, expected) => {
    expect(compareShoppingCoverage(basis(before.map(quantity => ({ quantity }))),
      basis(after.map(quantity => ({ quantity }))))).toBe(expected);
  });
  it('keeps unknown package wording and every operand intact for display', () => {
    const parts = [quantity(2, 'cans'), quantity(1, 'can')];
    expect(sumShoppingRequirements(parts)).toEqual(parts);
  });
  it('keeps unknown-package count qualifiers and equivalent numeric formatting', () => {
    const exact = { amount: 2, unit: 'can', exactQuantityV1: parseQuantityV1('2.0') };
    const approximate = { ...exact, exactQuantityV1: parseQuantityV1('about 2') };
    expect(compareShoppingCoverage(basis([{ quantity: exact }]), basis([{ quantity: quantity(2, 'can') }]))).toBe('Covered');
    expect(compareShoppingCoverage(basis([{ quantity: approximate }]), basis([{ quantity: exact }]))).toBe('RequirementChanged');
  });
  it('retains old evidence without letting ambiguous V1 coverage satisfy V2 demand', () => {
    const current = basis([{ quantity: quantity(2) }]);
    const old = { ...current, comparisonVersion: 1 as const };
    const saved = structuredClone(old);
    expect(compareShoppingCoverage(old, current)).toBe('RequirementChanged');
    expect(old).toEqual(saved);
    expect(compareShoppingCoverage(current, current)).toBe('Covered');
  });
});
