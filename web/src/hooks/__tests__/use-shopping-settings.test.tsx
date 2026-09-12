import { runHookCommand } from '@/test/shopping-hook-command-mock'
import type { ShoppingCommand } from '@/lib/shopping-command'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useSetShoppingExclusion,
  useUpdateIngredientExclusionSetting,
  useUpdateShoppingConfig,
} from '@/hooks/shopping/use-shopping-document'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV3,
  type ShoppingManualItemV1,
} from '@/lib/shopping-document'
import { shoppingKeys } from '@/lib/query-keys'
import { setActivePrincipalId } from '@/lib/principal-session'

const OWNER = 'owner-a'
const KEY = shoppingKeys.detail(OWNER)
const auth = vi.hoisted(() => ({ id: 'owner-a' as string | null }))
const show = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({
  states: new Map<string, ShoppingDocumentStateV3>(),
  beforeWrite: undefined as (() => void) | undefined,
  afterWrite: undefined as (() => Promise<void> | void) | undefined,
  beforeRead: undefined as (() => Promise<void> | void) | undefined,
  failWrite: false,
  writes: [] as { owner: string; revision: number; applied: boolean }[],
}))

vi.mock('@/lib/shopping-command-client', () => ({
  executeShoppingCommand: async (owner: string, command: ShoppingCommand) =>
    runHookCommand(command, () => db.states.get(owner)!, async (before, next) => {
      db.beforeWrite?.()
      const applied = !db.failWrite && auth.id === owner && db.states.get(owner)!.contentRevision === before.contentRevision
      db.writes.push({ owner, revision: before.contentRevision, applied })
      if (db.failWrite) throw new Error('Write failed')
      if (!applied) return false
      db.states.set(owner, structuredClone(next))
      await db.afterWrite?.()
      return true
    }),
}))
vi.mock('@/lib/auth-context', () => ({
  useAuthContext: () => ({ user: auth.id ? { id: auth.id } : null, loading: false }),
}))
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show }) }))
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'shopping_list') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => {
          let owner = auth.id!
          const read = {
            eq: (_column: string, value: string) => { owner = value; return read },
            maybeSingle: async () => {
              const snapshot = structuredClone(db.states.get(owner)!)
              await db.beforeRead?.()
              return { data: { document: snapshot.document, content_revision: snapshot.contentRevision }, error: null }
            },
          }
          return read
        },
        update: (values: { document: ShoppingDocumentStateV3['document']; content_revision: number }) => {
          const filters: Record<string, string | number> = {}
          const write = {
            eq: (column: string, value: string | number) => { filters[column] = value; return write },
            select: () => write,
            maybeSingle: async () => {
              db.beforeWrite?.()
              const owner = filters.user_id as string
              const revision = filters.content_revision as number
              const current = db.states.get(owner)!
              const applied = !db.failWrite && auth.id === owner && current.contentRevision === revision
              db.writes.push({ owner, revision, applied })
              if (db.failWrite) return { data: null, error: { message: 'Write failed' } }
              if (!applied) return { data: null, error: null }
              const committed = structuredClone({ document: values.document, contentRevision: values.content_revision })
              db.states.set(owner, committed)
              await db.afterWrite?.()
              return { data: { document: committed.document, content_revision: committed.contentRevision }, error: null }
            },
          }
          return write
        },
      }
    },
  }),
}))

function manual(id: string, changes: Partial<ShoppingManualItemV1> = {}): ShoppingManualItemV1 {
  return { id, displayName: id, quantity: null, categoryKey: 'misc', bucket: 'items', checked: false, ...changes }
}

function setup(withRecipes = false) {
  const document = createEmptyShoppingDocument()
  document.manualItems = [
    manual('garlic', { quantity: { amount: 2, unit: 'count' }, checked: true }),
    manual('rice', { bucket: 'already_have' }),
    manual('cilantro', { bucket: 'excluded' }),
  ]
  document.preferences.categoryOrder = ['misc', 'produce']
  document.preferences.excludedIngredientKeys = ['salt']
  if (withRecipes) {
    document.recipeEntries.recipe = {
      recipeId: 'recipe', recipeName: 'Soup', selectedServings: 2,
      scaleV1: { numerator: '1', denominator: '1' }, ingredients: [],
    }
  }
  const original = { document, contentRevision: 7 }
  db.states.set(OWNER, structuredClone(original))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(KEY, structuredClone(original))
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => ({ exclusion: useSetShoppingExclusion(), family: useUpdateIngredientExclusionSetting(), config: useUpdateShoppingConfig() }), { wrapper })
  return { ...hook, client, original }
}

function commit(mutation: ShoppingDocumentMutation) {
  db.states.set(OWNER, applyShoppingDocumentMutation(db.states.get(OWNER)!, mutation))
}

beforeEach(() => {
  auth.id = OWNER
  setActivePrincipalId(OWNER)
  show.mockReset()
  db.states.clear()
  db.beforeWrite = undefined
  db.afterWrite = undefined
  db.beforeRead = undefined
  db.failWrite = false
  db.writes = []
})

afterEach(() => { onlineManager.setOnline(true) })

describe('Shopping settings persistence and owner fencing', () => {
  it('reads authoritative state for cached duplicate and reports conflict without writing', async () => {
    const hook = setup();
    commit({ type: 'setExclusion', key: 'salt', enabled: false });
    const before = structuredClone(db.states.get(OWNER));
    await act(async () => {
      await expect(hook.result.current.exclusion.mutateAsync({ keyword: 'salt', enabled: true })).rejects.toThrow('Your change was not saved');
    });
    expect(db.writes).toEqual([]);
    expect(db.states.get(OWNER)).toEqual(before);
    expect(hook.client.getQueryData(KEY)).toEqual(before);
  });

  it('returns authoritative unchanged with no write, and normalizes repeated additions', async () => {
    const hook = setup();
    await act(async () => {
      expect(await hook.result.current.exclusion.mutateAsync({ keyword: ' Salt ', enabled: true })).toBe('unchanged');
      expect(await hook.result.current.exclusion.mutateAsync({ keyword: 'PEPPER', enabled: true })).toBe('applied');
    });
    await waitFor(() => expect(hook.result.current.exclusion.isPending).toBe(false));
    await act(async () => {
      expect(await hook.result.current.exclusion.mutateAsync({ keyword: 'pepper', enabled: true })).toBe('unchanged');
    });
    expect(db.states.get(OWNER)!.document.preferences.excludedIngredientKeys).toEqual(['salt', 'pepper']);
    expect(db.writes.filter(write => write.applied)).toHaveLength(1);
  });

  it('revalidates a family during replay and refreshes the cache on conflict', async () => {
    const hook = setup();
    db.beforeWrite = () => {
      db.beforeWrite = undefined;
      commit({ type: 'setFamilySetting', setting: 'excludeSaltVariants', enabled: true });
    };
    await act(async () => {
      await new Promise<void>(resolve => {
        hook.result.current.family.mutate({ setting: 'exclude_salt_variants', enabled: true }, {
          onError: () => resolve(),
        });
      });
    });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].applied).toBe(false);
    expect(hook.client.getQueryData(KEY)).toEqual(db.states.get(OWNER));
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({
      message: expect.stringContaining('Your change was not saved'),
    }));
  });

  it('guards mixed full-config replacement before writing and during replay', async () => {
    const hook = setup();
    db.beforeWrite = () => {
      db.beforeWrite = undefined;
      commit({ type: 'setExclusion', key: 'pepper', enabled: true });
    };
    await act(async () => {
      await expect(hook.result.current.config.mutateAsync({
        excluded_keywords: [], exclude_salt_variants: true, category_order: ['produce'],
      })).rejects.toThrow('Your change was not saved');
    });
    expect(db.writes).toHaveLength(1);
    expect(db.states.get(OWNER)!.document.preferences.excludedIngredientKeys).toEqual(['salt', 'pepper']);
    expect(db.states.get(OWNER)!.document.preferences.categoryOrder).toEqual(['misc', 'produce']);
  });

  it('does not optimistically display a failed save', async () => {
    const hook = setup();
    db.failWrite = true;
    await act(async () => {
      await expect(hook.result.current.exclusion.mutateAsync({ keyword: 'pepper', enabled: true })).rejects.toBeDefined();
    });
    expect(db.states.get(OWNER)).toEqual(hook.original);
    expect(hook.client.getQueryData(KEY)).toEqual(hook.original);
    expect(show).toHaveBeenCalled();
  });

  it('rejects a queued operation on account switch without redirecting it', async () => {
    const hook = setup();
    onlineManager.setOnline(false);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.exclusion.mutateAsync({ keyword: 'pepper', enabled: true });
      void pending.catch(() => {});
    });
    db.states.set('owner-b', structuredClone(hook.original));
    auth.id = 'owner-b';
    setActivePrincipalId('owner-b');
    hook.rerender();
    await act(async () => {
      onlineManager.setOnline(true);
      await expect(pending).rejects.toThrow();
    });
    expect(db.writes).toEqual([]);
    expect(db.states.get('owner-b')).toEqual(hook.original);
  });

  it('rejects an old submission closure after account switch', async () => {
    const hook = setup();
    const oldSubmit = hook.result.current.exclusion.mutateAsync;
    db.states.set('owner-b', structuredClone(hook.original));
    auth.id = 'owner-b';
    setActivePrincipalId('owner-b');
    hook.rerender();
    await act(async () => {
      await expect(oldSubmit({ keyword: 'pepper', enabled: true })).rejects.toThrow();
    });
    expect(db.writes).toEqual([]);
  });

  it('does not cache a late response after an owner switch', async () => {
    const hook = setup();
    db.afterWrite = () => { auth.id = 'owner-b'; setActivePrincipalId('owner-b'); };
    await act(async () => {
      await expect(hook.result.current.exclusion.mutateAsync({ keyword: 'pepper', enabled: true })).rejects.toThrow('account changed');
    });
    expect(hook.client.getQueryData(KEY)).toEqual(hook.original);
    expect(hook.client.getQueryData(shoppingKeys.detail('owner-b'))).toBeUndefined();
  });
});
