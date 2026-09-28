import type { ShoppingDocumentStateV3 } from './shopping-document';

export class ShoppingDocumentConflictError extends Error {
  constructor() {
    super('Shopping changed in another session. Review the latest list and try again.')
    this.name = 'ShoppingDocumentConflictError'
  }
}

export type ShoppingDocumentReplayValidator = (
  fresh: ShoppingDocumentStateV3
) => Promise<void> | void;
