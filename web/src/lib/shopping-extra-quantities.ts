import type { RationalV1, ShoppingQuantity } from '@/types/database';
import { normalizeRationalV1, parseRationalLexeme } from './recipe-quantity';
import { normalizeUnit } from './shopping-list-normalization';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';

export function isUnknownSizePackage(quantity: ShoppingQuantity | null): boolean {
  return Boolean(quantity && !quantity.exactPackageV1 &&
    resolveShoppingIngredientSemantics({ item: '', unit: quantity.unit }).quantityKind === 'package');
}

// Deliberately bounded, exact conversions. Kitchen measures and SI volume
// remain distinct rather than importing the old rounded ml approximations.
const conversions: Record<string, { unit: string; factor: number }> = {
  tbsp: { unit: 'tsp', factor: 3 }, cup: { unit: 'tsp', factor: 48 },
  kg: { unit: 'g', factor: 1000 }, l: { unit: 'ml', factor: 1000 },
};

export function addShoppingRationals(a: RationalV1, b: RationalV1): RationalV1 | null {
  const n = BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator);
  const d = BigInt(a.denominator) * BigInt(b.denominator);
  return normalizeRationalV1({ numerator: String(n), denominator: String(d) });
}

/** Every non-scalar occurrence survives. Scalars merge only with exact,
 * supported same-dimension arithmetic; overflow retains separate operands.
 */
export function sumShoppingRequirements(operands: (ShoppingQuantity | null)[]): ShoppingQuantity[] {
  const result: ShoppingQuantity[] = [];
  const scalars = new Map<string, number>();
  for (const operand of operands) {
    const part = structuredClone(operand ?? { amount: null, unit: '' });
    const exact = part.exactQuantityV1;
    let amount = exact?.kind === 'exact' ? exact.value :
      !exact && part.amount !== null ? parseRationalLexeme(String(part.amount)) : null;
    if (!amount || part.exactPackageV1 || isUnknownSizePackage(part)) { result.push(part); continue; }
    let unit = normalizeUnit(part.unit);
    if (unit === 'count') unit = '';
    const conversion = conversions[unit];
    if (conversion) {
      amount = normalizeRationalV1({ numerator: String(BigInt(amount.numerator) * BigInt(conversion.factor)), denominator: amount.denominator });
      if (!amount) { result.push(part); continue; }
      unit = conversion.unit;
    }
    const index = scalars.get(unit);
    if (index !== undefined) {
      const previous = result[index].exactQuantityV1;
      const total = previous?.kind === 'exact' ? addShoppingRationals(previous.value, amount) : null;
      if (!total) { result.push(part); continue; }
      amount = total;
    }
    const lexeme = amount.denominator === '1' ? amount.numerator : `${amount.numerator}/${amount.denominator}`;
    const sum: ShoppingQuantity = { amount: Number(amount.numerator) / Number(amount.denominator), unit,
      exactQuantityV1: { version: 1, kind: 'exact', value: amount, lexeme, authored: lexeme, source: 'legacy-synthesized' } };
    if (index === undefined) { scalars.set(unit, result.length); result.push(sum); }
    else result[index] = sum;
  }
  return result;
}
