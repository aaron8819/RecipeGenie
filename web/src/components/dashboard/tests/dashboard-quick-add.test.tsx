import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dashboard } from '../dashboard';

const add = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const query = { isLoading: false, isError: false, refetch: vi.fn() };
vi.mock('@/hooks/use-shopping', () => ({
  useShoppingList: () => ({ ...query, data: { items: [
    { item: 'onion', orderingKey: 'onion', rowId: 'derived:onion', amount: 4, unit: 'count' },
    { item: 'deli turkey', orderingKey: 'deli turkey', rowId: 'manual:turkey', amount: null, unit: '', checked: true },
  ] } }),
  useAddShoppingItem: () => add,
  useAddToShoppingList: () => add,
  useCheckOffItem: () => add,
}));
vi.mock('@/hooks/use-planner', () => ({
  useUserConfig: () => ({ ...query, data: { week_start_day: 1 } }),
  useWeeklyPlan: () => ({ ...query, data: { recipe_ids: [] } }),
  useWeeklyPlanRecipes: () => ({ ...query, data: [] }),
  useRecentRecipeHistory: () => ({ ...query, data: [] }),
  useMarkRecipeMade: () => add, useRemoveRecipeFromPlan: () => add,
  useAddRecipeToPlan: () => add, useSaveDayAssignments: () => add,
}));
vi.mock('@/hooks/use-local-calendar-date', () => ({ useLocalCalendarDate: () => '2026-10-04' }));
vi.mock('@/hooks/use-replace-planned-recipe', () => ({ useReplacePlannedRecipe: () => add }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }));
vi.mock('@/components/planner/add-recipe-to-plan-modal', () => ({ AddRecipeToPlanModal: () => null }));
vi.mock('@/components/planner/swap-meal-dialog', () => ({ SwapMealDialog: () => null }));
vi.mock('@/components/shopping/shopping-selection-dialog', () => ({ ShoppingSelectionDialog: () => null }));
afterEach(() => { cleanup(); add.mutateAsync.mockReset(); });

describe('Dashboard quick-add with accepted Shopping purchase identities', () => {
  it('skips recipe aliases, checked purchases, and duplicates in one pasted list', async () => {
    add.mutateAsync.mockResolvedValue({});
    render(<Dashboard />);
    const input = screen.getByLabelText('Quick add shopping items');
    fireEvent.change(input, { target: { value: 'white onion, deli turkey, cereal, cereal' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(add.mutateAsync).toHaveBeenCalledTimes(1));
    expect(add.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ itemName: 'cereal' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(within(screen.getByRole('region', { name: 'Shopping' })).getByRole('status')).toHaveTextContent('3 items were already on the shopping list');
    expect(input).toHaveFocus();
  });

  it('keeps a failed conflict draft available for recovery and returns focus', async () => {
    add.mutateAsync.mockRejectedValue(new Error('Shopping changed in another session'));
    render(<Dashboard />);
    const input = screen.getByLabelText('Quick add shopping items');
    fireEvent.change(input, { target: { value: 'crackers' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Shopping' })).getByRole('status')).toHaveTextContent('Could not add "crackers"'));
    expect(input).toHaveValue('crackers');
    expect(input).toHaveFocus();
  });
});
