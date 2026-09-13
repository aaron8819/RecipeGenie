'use client';

import { canonicalShoppingPayload, shoppingOutcomeMessage, type ShoppingCommand, type ShoppingReceipt } from './shopping-command';
import { getActivePrincipalId } from './principal-session';
import { ShoppingDocumentConflictError } from './shopping-document-persistence';
import type { ShoppingDocumentStateV3 } from './shopping-document';

interface Attempt {
  operationId: string;
  command: ShoppingCommand;
  sequence?: string;
  failure?: string;
}
interface CommandResponse {
  status: string;
  sequence?: string;
  receipt?: ShoppingReceipt;
  before?: ShoppingDocumentStateV3;
}
export function shoppingPendingAttempt(owner: string): string | null {
  return sessionStorage.getItem(`shopping-attempt-v1:${owner}`);
}
export function subscribeShoppingAttempt(listener: () => void) {
  window.addEventListener('shopping-attempt', listener);
  return () => window.removeEventListener('shopping-attempt', listener);
}
function storeAttempt(owner: string, attempt: Attempt | null) {
  const key = `shopping-attempt-v1:${owner}`;
  if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
  else sessionStorage.removeItem(key);
  window.dispatchEvent(new Event('shopping-attempt'));
}
export function acknowledgeUnknownShoppingAttempt(owner: string, expected: string) {
  if (getActivePrincipalId() !== owner || shoppingPendingAttempt(owner) !== expected) throw new ShoppingCommandError('OutcomeUnknown');
  const attempt: Attempt = JSON.parse(expected);
  if (!['RetryExpired', 'UnknownAdmission', 'OutcomeUnknown'].includes(attempt.failure || '')) throw new ShoppingCommandError('OutcomeUnknown');
  storeAttempt(owner, null);
}
export class ShoppingCommandError extends ShoppingDocumentConflictError {
  constructor(readonly status: string) {
    super();
    this.message = shoppingOutcomeMessage(status);
    this.name = 'ShoppingCommandError';
  }
}

export async function executeShoppingCommand(owner: string, command: ShoppingCommand): Promise<CommandResponse> {
  // The server already holds the owner/revision-bound inverse. Never put the
  // inverse in request/session storage or subject it to command traversal limits.
  const compact = (value: ShoppingCommand): ShoppingCommand => value.mutation.type === 'restoreContent'
    ? { ...value, mutation: { type: 'undoClear' } } : value;
  const assertOwner = () => {
    if (getActivePrincipalId() !== owner) throw new ShoppingCommandError('OutcomeUnknown');
  };
  assertOwner();
  const key = `shopping-attempt-v1:${owner}`;
  // Persist before sending admission. A reload or lost response must recover,
  // never admit anew. Storage failure prevents dispatch, not deduplication.
  const saved = sessionStorage.getItem(key);
  let attempt: Attempt;
  try {
    attempt = saved ? JSON.parse(saved) : { operationId: crypto.randomUUID(), command: compact(command) };
    // A retained pre-correction attempt must keep its original payload/hash.
    // Compact new attempts and retries of compact attempts only.
    if (!saved || attempt.command.mutation.type === 'undoClear') command = compact(command);
  }
  catch { throw new ShoppingCommandError('OutcomeUnknown'); }
  if (canonicalShoppingPayload(attempt.command) !== canonicalShoppingPayload(command)) throw new ShoppingCommandError('OutcomeUnknown');
  storeAttempt(owner, { ...attempt, failure: undefined });
  const send = async (phase: string): Promise<CommandResponse> => {
    assertOwner();
    const result = await fetch('/api/shopping', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: attempt.operationId, command: attempt.command, sequence: attempt.sequence, phase }),
    });
    assertOwner();
    return result.json();
  };
  try {
    if (!attempt.sequence) {
      let admission: CommandResponse;
      try { admission = await send(saved ? 'recover' : 'admit'); }
      catch { admission = await send('recover'); }
      if (admission.status !== 'Admitted' || !admission.sequence) {
        // Capacity proves no admission was issued. Unknown outcomes retain the
        // attempt and cannot silently mint a new operation on the next click.
        if (['RetryCapacity', 'UpdateRequired', 'InvalidInput', 'Unauthenticated', 'Forbidden'].includes(admission.status)) storeAttempt(owner, null);
        throw new ShoppingCommandError(admission.status);
      }
      attempt = { ...attempt, sequence: admission.sequence };
      storeAttempt(owner, attempt);
    }
    let result: CommandResponse;
    try { result = await send('execute'); } catch { result = await send('execute'); }
    if (result.receipt) {
      if (!Number.isSafeInteger(result.receipt.revision) || result.receipt.revision < 0 ||
        !['Applied', 'Unchanged', 'Conflict', 'TargetGone', 'InvalidInput', 'UnsupportedDocument', 'UndoUnavailable'].includes(result.receipt.outcome)) {
        throw new ShoppingCommandError('OutcomeUnknown');
      }
      storeAttempt(owner, null);
      if (!['Applied', 'Unchanged'].includes(result.receipt.outcome)) throw new ShoppingCommandError(result.receipt.outcome);
      return result;
    }
    throw new ShoppingCommandError(result.status);
  } catch (error) {
    if (shoppingPendingAttempt(owner)) storeAttempt(owner, {
      ...attempt, failure: error instanceof ShoppingCommandError ? error.status : 'OutcomeUnknown',
    });
    if (error instanceof ShoppingCommandError) throw error;
    throw new ShoppingCommandError('OutcomeUnknown');
  }
}
