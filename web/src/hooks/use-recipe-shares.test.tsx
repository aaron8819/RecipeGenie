import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAcceptRecipeShare,
  useDeclineRecipeShare,
  useIncomingRecipeShares,
  useSentRecipeShares,
} from './use-recipe-shares';
import { shareKeys } from '@/lib/query-keys';

const auth = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null }));
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => auth }));

const fetchMock = vi.fn<typeof fetch>();
let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function useLists(open: boolean) {
  return { incoming: useIncomingRecipeShares(open), sent: useSentRecipeShares(open) };
}

function requestedUrls(): unknown[] {
  return fetchMock.mock.calls.map(([url]) => url);
}

async function expectLoaded(): Promise<void> {
  await waitFor(() => {
    expect(queryClient.getQueryData(shareKeys.inbox('owner'))).toEqual([]);
    expect(queryClient.getQueryData(shareKeys.sent('owner'))).toEqual([]);
  });
}

beforeEach(() => {
  auth.user = { id: 'owner' };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sharing list request gating', () => {
  it('makes no requests while closed, then fetches each endpoint once on open', async () => {
    const { result, rerender } = renderHook(({ open }) => useLists(open), {
      initialProps: { open: false }, wrapper: Wrapper,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.incoming.fetchStatus).toBe('idle');
    expect(result.current.sent.fetchStatus).toBe('idle');
    rerender({ open: true });
    await expectLoaded();
    expect(requestedUrls().sort()).toEqual([
      '/api/recipe-shares/inbox', '/api/recipe-shares/sent',
    ]);
  });

  it('reuses fresh cache on reopening', async () => {
    const { rerender } = renderHook(({ open }) => useLists(open), {
      initialProps: { open: true }, wrapper: Wrapper,
    });
    await expectLoaded();
    rerender({ open: false });
    rerender({ open: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes stale cache on reopening while retaining the cached lists', async () => {
    const { result, rerender } = renderHook(({ open }) => useLists(open), {
      initialProps: { open: true }, wrapper: Wrapper,
    });
    await expectLoaded();
    rerender({ open: false });
    act(() => {
      for (const key of [shareKeys.inbox('owner'), shareKeys.sent('owner')]) {
        queryClient.setQueryData(key, [], { updatedAt: Date.now() - 16_000 });
      }
    });
    rerender({ open: true });
    expect(result.current.incoming.data).toEqual([]);
    expect(result.current.sent.data).toEqual([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('defers invalidated closed queries until reopening', async () => {
    const { rerender } = renderHook(({ open }) => useLists(open), {
      initialProps: { open: true }, wrapper: Wrapper,
    });
    await expectLoaded();
    rerender({ open: false });
    await act(async () => { await queryClient.invalidateQueries({
      queryKey: shareKeys.all('owner'),
    }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rerender({ open: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('stays disabled without an authenticated user even when open', () => {
    auth.user = null;
    const { result } = renderHook(() => useLists(true), { wrapper: Wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.incoming.fetchStatus).toBe('idle');
    expect(result.current.sent.fetchStatus).toBe('idle');
  });

  it('preserves default enabled behavior for callers without an argument', async () => {
    renderHook(() => ({ incoming: useIncomingRecipeShares(), sent: useSentRecipeShares() }), {
      wrapper: Wrapper,
    });
    await expectLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['accept', 'decline'] as const)(
    'preserves %s writes and invalidations without refetching a closed inbox', async (action) => {
      const { result, rerender } = renderHook(({ open }) => ({
        ...useLists(open), accept: useAcceptRecipeShare(), decline: useDeclineRecipeShare(),
      }), { initialProps: { open: true }, wrapper: Wrapper });
      await expectLoaded();
      rerender({ open: false });
      await act(async () => { await result.current[action].mutateAsync('share-1'); });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenLastCalledWith(`/api/recipe-shares/share-1/${action}`, {
        method: 'POST',
      });
      expect(queryClient.getQueryState(shareKeys.inbox('owner'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(shareKeys.sent('owner'))?.isInvalidated).toBe(true);
      rerender({ open: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    },
  );
});
