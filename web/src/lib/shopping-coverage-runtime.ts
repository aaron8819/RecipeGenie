import type { ProjectedShoppingRow } from './shopping-document';
import type { ShoppingQuantity } from '@/types/database';
import { parseRationalLexeme } from './recipe-quantity';
import { normalizeUnit } from './shopping-list-normalization';
import { isUnknownSizePackage, sumShoppingRequirements } from './shopping-extra-quantities';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';
import type { CoveragePart, ShoppingCoverageBasis } from './shopping-coverage';

/** Captured raw alternatives are source evidence, not Pantry family matches. */
export function shoppingMaterialKey(purchaseKey: string, alternatives: string[] = []): string {
  const allowed = [...new Set([purchaseKey, ...alternatives.map(item =>
    resolveShoppingIngredientSemantics({ item }).purchaseKey)])].sort();
  return allowed.length === 1 ? purchaseKey : JSON.stringify(['alternatives', allowed]);
}

function coveragePart(purchaseKey: string, materialKey: string, quantity: ShoppingQuantity | null): CoveragePart {
  const q = quantity?.exactQuantityV1;
  const unit = normalizeUnit(quantity?.unit ?? '');
  const common = { purchaseKey, materialKey, unit: unit === 'count' ? '' : unit };
  const pkg = quantity?.exactPackageV1;
  if (pkg && pkg.count.kind === 'exact') return { ...common, kind: 'package',
    descriptor: pkg.type, size: pkg.size.value, sizeUnit: normalizeUnit(pkg.size.unit), amount: pkg.count.value };
  if (pkg) return { ...common, kind: 'token', token: JSON.stringify([pkg.type, pkg.size.value, pkg.size.unit, pkg.count]) };
  const amount = q?.kind === 'exact' ? q.value : !q && quantity?.amount != null ? parseRationalLexeme(String(quantity.amount)) : null;
  if (isUnknownSizePackage(quantity)) return { ...common, kind: 'token',
    token: JSON.stringify(['unknown-package', unit, Boolean(q?.qualifier),
      amount ?? (q?.kind === 'range' ? [q.start, q.end] : q?.authored.trim().toLowerCase().replace(/\s+/g, ' ') || 'unspecified')]) };
  if (q?.kind === 'range') return { ...common, kind: 'range', minimum: q.start, maximum: q.end };
  if (amount) return { ...common, kind: 'scalar', amount };
  return { ...common, kind: 'token', token: q && 'authored' in q ? q.authored.trim().toLowerCase() || 'unspecified' : 'unspecified' };
}

/** Only buyable, unrounded operands; sum uses the bounded exact unit catalog. */
export function shoppingRowCoverage(row: ProjectedShoppingRow): ShoppingCoverageBasis {
  const materials = new Map<string, (ShoppingQuantity | null)[]>();
  for (const part of row.requirements ?? []) {
    if (part.bucket !== 'items') continue;
    const key = part.materialKey ?? row.orderingKey;
    const quantities = materials.get(key);
    if (quantities) quantities.push(part.quantity);
    else materials.set(key, [part.quantity]);
  }
  return { comparisonVersion: 2, parts: [...materials].flatMap(([key, quantities]) =>
    sumShoppingRequirements(quantities).map(part => coveragePart(row.orderingKey, key, part))) };
}
