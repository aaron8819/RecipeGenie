import { validateShoppingDocumentStateV3, type ShoppingDocumentStateV3 } from './shopping-document'

export type ShoppingReadOutcome =
  | { status: 'Supported'; state: ShoppingDocumentStateV3; sourceVersion: number }
  | { status: 'Malformed' | 'UnsupportedDocument'; original: unknown }

/** Reads never initialize, persist upgrades or replace invalid data with empty. */
export function readShoppingCompatibility(document: unknown, contentRevision: number): ShoppingReadOutcome {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { status: 'Malformed', original: document }
  }
  const version = 'schemaVersion' in document ? document.schemaVersion : undefined
  if (typeof version !== 'number' || !Number.isSafeInteger(version) ||
      !Number.isSafeInteger(contentRevision) || contentRevision < 0) {
    return { status: 'Malformed', original: document }
  }
  if (![1, 2, 3].includes(version)) return { status: 'UnsupportedDocument', original: document }
  const validation = validateShoppingDocumentStateV3({ document, contentRevision })
  return validation.ok
    ? { status: 'Supported', sourceVersion: version,
        state: { document: validation.document, contentRevision } }
    : { status: 'Malformed', original: document }
}
