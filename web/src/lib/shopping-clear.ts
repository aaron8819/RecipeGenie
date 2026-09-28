import type { ShoppingDocumentV3 } from './shopping-document';

export const SHOPPING_INVERSE_BYTES = 1048576;
export type ShoppingContent = Pick<ShoppingDocumentV3,
  'recipeEntries' | 'manualItems' | 'itemOverrides' | 'acknowledgements' | 'tripVisibility'>;

export function shoppingContent(document: ShoppingContent): ShoppingContent {
  return { recipeEntries: document.recipeEntries, manualItems: document.manualItems,
    itemOverrides: document.itemOverrides, ...(document.acknowledgements ? { acknowledgements: document.acknowledgements } : {}),
    ...(document.tripVisibility ? { tripVisibility: document.tripVisibility } : {}) };
}

// PostgreSQL jsonb::text uses spaces after separators and expands exponent
// notation. Key order does not affect byte count. Count the actual UTF-8
// representation used by the existing bounded inverse store, not JS length.
export function shoppingInverseBytes(value: unknown): number {
  const encode = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(encode).join(', ')}]`;
    if (item && typeof item === 'object') return `{${Object.entries(item)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}: ${encode(v)}`).join(', ')}}`;
    if (typeof item === 'number' && /e/i.test(String(item))) {
      const [mantissa, exponent] = String(item).split('e');
      const negative = mantissa.startsWith('-');
      const unsigned = negative ? mantissa.slice(1) : mantissa;
      const digits = unsigned.replace('.', '');
      const position = unsigned.split('.')[0].length + Number(exponent);
      const decimal = position <= 0 ? `0.${'0'.repeat(-position)}${digits}` :
        position >= digits.length ? digits + '0'.repeat(position - digits.length) :
        `${digits.slice(0, position)}.${digits.slice(position)}`;
      return (negative ? '-' : '') + decimal;
    }
    return JSON.stringify(item);
  };
  return new TextEncoder().encode(encode(value)).byteLength;
}

export function canUndoShoppingClear(document: ShoppingContent): boolean {
  // Compatibility fallback for in-memory hook adapters. Persisted states use
  // the database computed field, including original numeric scale and the
  // full-document limit; execution always receives that authoritative field.
  return shoppingInverseBytes(shoppingContent(document)) <= SHOPPING_INVERSE_BYTES;
}
