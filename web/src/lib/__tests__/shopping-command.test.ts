import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readShoppingCommand, canonicalShoppingPayload, type ShoppingCommand } from '../shopping-command';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { createEmptyShoppingDocument, type ShoppingManualItemV1 } from '../shopping-document';
import { executeShoppingCommand } from '../shopping-command-client';
import { setActivePrincipalId } from '../principal-session';
import { shoppingCompatibilityFixture } from '@/test/shopping-compatibility-fixtures';

const manual: ShoppingManualItemV1 = { id: 'a', displayName: 'milk', quantity: null, bucket: 'items', checked: false, categoryKey: 'dairy' };
const command = (mutation: ShoppingCommand['mutation'], observedRevision = 0): ShoppingCommand => ({ protocol: 1, observedRevision, mutation });
const snapshot = (): ShoppingCommandContext => ({ status: 'Pending', row: { document: createEmptyShoppingDocument(), content_revision: 0 },
  dependencyRevision: '0', pantry: [], recipes: [], inverse: null, inverseRevision: null });

describe('trusted Shopping command planning', () => {
  it.each([null, [], {}, { protocol: 0 }, { protocol: 1, observedRevision: -1, mutation: { type: 'complete' } },
    command({ type: 'complete', document: {} } as never), command({ type: 'editManualItem', id: 'a', changes: { id: 'forged' } } as never),
    command({ type: 'setChecked', rowRef: 'manual:a', checked: 'true' } as never),
  ])('rejects malformed command %j', (value) => { expect(readShoppingCommand(value)).toBeNull(); });
  it('rejects excessive depth, length and unknown owner fields', () => {
    expect(readShoppingCommand({ ...command({ type: 'complete' }), owner: 'other' })).toBeNull();
    expect(readShoppingCommand(command({ type: 'setExclusion', key: 'x'.repeat(17000), enabled: true }))).toBeNull();
    let nested: unknown = null;
    for (let i = 0; i < 26; i++) nested = [nested];
    expect(readShoppingCommand(command({ type: 'restoreContent', content: nested } as never))).toBeNull();
  });
  it('binds payload independent of JSON object key order', () => {
    expect(canonicalShoppingPayload({ b: 2, a: 1 })).toBe(canonicalShoppingPayload({ a: 1, b: 2 }));
    expect(canonicalShoppingPayload([1, 2])).not.toBe(canonicalShoppingPayload([2, 1]));
  });
  it('no-op uses current state, not cached equality', () => {
    const s = snapshot();
    expect(planShoppingCommand(s, command({ type: 'setExclusion', key: 'cumin', enabled: false })).outcome).toBe('Unchanged');
    s.row!.document = { ...createEmptyShoppingDocument(), manualItems: [{ ...manual, checked: true }] };
    expect(planShoppingCommand(s, command({ type: 'setChecked', rowRef: 'manual:a', checked: false })).outcome).toBe('Applied');
  });
  it('preserves unsupported documents and refuses empty replacement', () => {
    const s = snapshot(); s.row!.document = { schemaVersion: 99, preserved: 'evidence' };
    const original = structuredClone(s);
    expect(planShoppingCommand(s, command({ type: 'complete' })).outcome).toBe('UnsupportedDocument');
    expect(s).toEqual(original);
  });
  it('rejects forged Clear content even at the current revision', () => {
    const s = snapshot();
    expect(planShoppingCommand(s, command({ type: 'restoreContent', content: { recipeEntries: {}, manualItems: [manual], itemOverrides: {} } })).outcome).toBe('UndoUnavailable');
  });
  it('keeps frozen quantities, source multiplicity and hidden order during manual edits', () => {
    const { document } = shoppingCompatibilityFixture();
    const s = snapshot(); s.row!.document = document;
    const original = structuredClone(document);
    const result = planShoppingCommand(s, command({ type: 'editManualItem', id: document.manualItems[0].id, changes: { quantity: { amount: 3.5, unit: 'count' } } }));
    expect(result.outcome).toBe('Applied');
    expect(result.document.recipeEntries).toEqual(original.recipeEntries);
    expect(result.document.preferences).toEqual(original.preferences);
    expect(document).toEqual(original);
  });
  it('manual collisions, missing targets and stale bridge are explicit rejections', () => {
    const s = snapshot(); s.row = { document: { ...createEmptyShoppingDocument(), manualItems: [manual] }, content_revision: 1 };
    expect(planShoppingCommand(s, command({ type: 'addManualItem', item: { ...manual, id: 'b' } }, 1)).outcome).toBe('Conflict');
    expect(planShoppingCommand(s, command({ type: 'deleteManualItem', id: 'missing' }, 1)).outcome).toBe('TargetGone');
    expect(planShoppingCommand(s, command({ type: 'pantry', rowRef: 'manual:a' }, 0)).outcome).toBe('Conflict');
  });
});

describe('bounded client retry delivery', () => {
  const fetchMock = vi.fn();
  const c = command({ type: 'complete' });
  const reply = (value: unknown) => ({ json: async () => value });
  beforeEach(() => { sessionStorage.clear(); setActivePrincipalId('owner'); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  it('recovers a lost admission response and retries a lost execution with the same identity', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost admission'))
      .mockResolvedValueOnce(reply({ status: 'Admitted', sequence: '7' }))
      .mockRejectedValueOnce(new Error('lost execution'))
      .mockResolvedValueOnce(reply({ status: 'AlreadyApplied', receipt: { outcome: 'Applied', revision: 5 } }));
    expect((await executeShoppingCommand('owner', c)).status).toBe('AlreadyApplied');
    const bodies = fetchMock.mock.calls.map((args) => JSON.parse(args[1].body));
    expect(bodies.map((body) => body.phase)).toEqual(['admit', 'recover', 'execute', 'execute']);
    expect(new Set(bodies.map((body) => body.operationId)).size).toBe(1);
    expect(bodies[2]).toEqual(bodies[3]);
  });
  it('never replaces an uncertain operation with a fresh UUID or changed payload', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(executeShoppingCommand('owner', c)).rejects.toThrow('outcome is unknown');
    const calls = fetchMock.mock.calls.length;
    await expect(executeShoppingCommand('owner', command({ type: 'setExclusion', key: 'new', enabled: true }))).rejects.toThrow('outcome is unknown');
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    fetchMock.mockResolvedValue(reply({ status: 'OutcomeUnknown' }));
    await expect(executeShoppingCommand('owner', c)).rejects.toThrow('outcome is unknown');
    expect(JSON.parse(fetchMock.mock.lastCall![1].body).phase).toBe('recover');
  });
  it('capacity is a recoverable refusal and terminal conflicts do not claim success', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 'RetryCapacity' }));
    await expect(executeShoppingCommand('owner', c)).rejects.toThrow('Too many');
    expect(sessionStorage.length).toBe(0);
    fetchMock.mockResolvedValueOnce(reply({ status: 'Admitted', sequence: '1' }))
      .mockResolvedValueOnce(reply({ status: 'Conflict', receipt: { outcome: 'Conflict', revision: 1 } }));
    await expect(executeShoppingCommand('owner', c)).rejects.toThrow('another session');
  });
  it('owner switch fences a late response and sends no execution as the new principal', async () => {
    fetchMock.mockImplementation(async () => { setActivePrincipalId('other'); return reply({ status: 'Admitted', sequence: '1' }); });
    await expect(executeShoppingCommand('owner', c)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('F3 serializes large inverses as bounded references on every retry', async () => {
    const content = { recipeEntries: {}, manualItems: Array.from({ length: 6000 }, (_, i) => ({ ...manual, id: String(i) })), itemOverrides: {} };
    fetchMock.mockRejectedValueOnce(new Error('lost admission'))
      .mockResolvedValueOnce(reply({ status: 'Admitted', sequence: '7' }))
      .mockRejectedValueOnce(new Error('lost execution'))
      .mockResolvedValueOnce(reply({ status: 'AlreadyApplied', receipt: { outcome: 'Applied', revision: 9 } }));
    await executeShoppingCommand('owner', command({ type: 'restoreContent', content }, 8));
    const bodies = fetchMock.mock.calls.map((args) => JSON.parse(args[1].body));
    expect(bodies.every((body) => body.command.mutation.type === 'undoClear' && !('content' in body.command.mutation))).toBe(true);
    expect(bodies.every((body) => new TextEncoder().encode(JSON.stringify(body)).byteLength < 256)).toBe(true);
    expect(bodies[2]).toEqual(bodies[3]);
    expect(sessionStorage.length).toBe(0);
  });

  it('F3 retains pre-correction retry payloads rather than changing an issued hash', async () => {
    const legacy = command({ type: 'restoreContent', content: { recipeEntries: {}, manualItems: [manual], itemOverrides: {} } }, 8);
    sessionStorage.setItem('shopping-attempt-v1:owner', JSON.stringify({ operationId: 'retained', sequence: '7', command: legacy }));
    fetchMock.mockResolvedValue(reply({ status: 'AlreadyApplied', receipt: { outcome: 'Applied', revision: 9 } }));
    await executeShoppingCommand('owner', legacy);
    expect(JSON.parse(fetchMock.mock.lastCall![1].body).command).toEqual(legacy);
  });
});
