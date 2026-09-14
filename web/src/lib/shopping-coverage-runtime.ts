import type { ProjectedShoppingRow } from './shopping-document';
import type { ShoppingQuantity } from '@/types/database';
import { parseRationalLexeme } from './recipe-quantity';
import { normalizeUnit } from './shopping-list-normalization';
import { sumShoppingRequirements } from './shopping-extra-quantities';
import type { CoveragePart, ShoppingCoverageBasis } from './shopping-coverage';

function coveragePart(purchaseKey: string, quantity: ShoppingQuantity | null): CoveragePart {
  const q = quantity?.exactQuantityV1;
  const unit = normalizeUnit(quantity?.unit ?? '');
  const common = { purchaseKey, materialKey: purchaseKey, unit: unit === 'count' ? '' : unit };
  const pkg = quantity?.exactPackageV1;
  if (pkg && pkg.count.kind === 'exact') return { ...common, kind: 'package',
    descriptor: pkg.type, size: pkg.size.value, sizeUnit: normalizeUnit(pkg.size.unit), amount: pkg.count.value };
  if (pkg) return { ...common, kind: 'token', token: JSON.stringify([pkg.type, pkg.size.value, pkg.size.unit, pkg.count]) };
  if (q?.kind === 'range') return { ...common, kind: 'range', minimum: q.start, maximum: q.end };
  const amount = q?.kind === 'exact' ? q.value : !q && quantity?.amount != null ? parseRationalLexeme(String(quantity.amount)) : null;
  if (amount) return { ...common, kind: 'scalar', amount };
  return { ...common, kind: 'token', token: q && 'authored' in q ? q.authored.trim().toLowerCase() || 'unspecified' : 'unspecified' };
}

/** Only buyable, unrounded operands; sum uses the bounded exact unit catalog. */
export function shoppingRowCoverage(row: ProjectedShoppingRow): ShoppingCoverageBasis {
  return { comparisonVersion: 1, parts: sumShoppingRequirements(
    (row.requirements ?? []).filter(part => part.bucket === 'items').map(part => part.quantity),
  ).map(part => coveragePart(row.orderingKey, part)) };
}
