import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let snapshot: unknown;
let shareStatus: 'pending' | 'accepted';

const shareQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

shareQuery.select.mockReturnValue(shareQuery);
shareQuery.eq.mockReturnValue(shareQuery);
shareQuery.maybeSingle.mockImplementation(async () => ({
  data: {
    source_recipe_snapshot: snapshot,
    status: shareStatus,
  },
  error: null,
}));

const supabaseMock = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: 'recipient-a' } },
      error: null,
    })),
  },
  from: vi.fn(() => shareQuery),
  rpc: rpcMock,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => supabaseMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
}));

import { POST } from './route';

const structuredSnapshot = {
  name: 'Soup',
  category: 'dinner',
  servings: 4,
  tags: [],
  ingredients: [],
  instructions: [],
};

async function acceptShare() {
  return POST(new Request('http://localhost'), {
    params: Promise.resolve({ id: 'share-a' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  shareQuery.select.mockReturnValue(shareQuery);
  shareQuery.eq.mockReturnValue(shareQuery);
  shareStatus = 'pending';
  snapshot = structuredSnapshot;
  rpcMock.mockResolvedValue({
    data: 'accepted-recipe-a',
    error: null,
  });
});

describe('recipe share acceptance route', () => {
  it('passes a current structured snapshot to the authoritative RPC', async () => {
    const response = await acceptShare();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acceptedRecipeId: 'accepted-recipe-a',
    });
    expect(rpcMock).toHaveBeenCalledWith('accept_recipe_share', {
      p_share_id: 'share-a',
    });
  });

  it('passes the supported legacy empty snapshot unchanged to the RPC', async () => {
    snapshot = {};

    const response = await acceptShare();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith('accept_recipe_share', {
      p_share_id: 'share-a',
    });
  });

  it('allows an idempotent retry for an accepted legacy empty snapshot', async () => {
    snapshot = {};
    shareStatus = 'accepted';

    const response = await acceptShare();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acceptedRecipeId: 'accepted-recipe-a',
    });
    expect(rpcMock).toHaveBeenCalledOnce();
  });

  it('allows an idempotent retry for an accepted structured snapshot', async () => {
    shareStatus = 'accepted';

    const response = await acceptShare();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acceptedRecipeId: 'accepted-recipe-a',
    });
    expect(rpcMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['partially populated object', { name: 'Incomplete' }],
    ['null', null],
    ['array', []],
    ['string scalar', 'snapshot'],
    ['number scalar', 1],
    ['boolean', false],
    ['malformed object', { ...structuredSnapshot, tags: {} }],
  ])('rejects a %s before invoking the RPC', async (_name, invalidSnapshot) => {
    snapshot = invalidSnapshot;

    const response = await acceptShare();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Shared recipe data is invalid',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
