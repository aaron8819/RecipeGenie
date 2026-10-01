import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShoppingCheckIntents } from '../use-shopping-check-intents';
import type { ShoppingItem } from '@/types/database';
const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-shopping', () => ({ useCheckOffItem: () => ({ mutateAsync: mutate }) }));
const item = { rowId: 'derived:carrot', checked: false, inspectedRevision: 7,
  inspectedCoverage: { version: 3, basis: { comparisonVersion: 2, parts: [] } } } as unknown as ShoppingItem;
beforeEach(() => { mutate.mockReset(); });
describe('shared check-off intents', () => {
  it('forwards inspected evidence and keeps rapid reversal until its own write settles', async () => {
    let first!: () => void; let second!: () => void;
    mutate.mockImplementationOnce(() => new Promise<void>(r => { first = r; }))
      .mockImplementationOnce(() => new Promise<void>(r => { second = r; }));
    const { result } = renderHook(useShoppingCheckIntents);
    act(() => result.current.handleCheckOff(item));
    act(() => result.current.handleCheckOff(item));
    expect(mutate.mock.calls.map(([value]) => value)).toEqual([true, false].map(checked => ({
      rowRef: item.rowId, checked, inspectedCoverage: item.inspectedCoverage, inspectedRevision: 7,
    })));
    await act(async () => first());
    expect(result.current.pendingCheckIntents.get(item.rowId!)?.checked).toBe(false);
    await act(async () => second());
    expect(result.current.pendingCheckIntents.size).toBe(0);
  });
  it('rolls back a failed current intent', async () => {
    mutate.mockRejectedValue(new Error('failed write'));
    const { result } = renderHook(useShoppingCheckIntents);
    act(() => result.current.handleCheckOff(item));
    await waitFor(() => expect(result.current.pendingCheckIntents.size).toBe(0));
  });
});
