import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SwapMealDialog } from '../swap-meal-dialog';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';

const recipes = ['Soup', 'Salad', 'Pasta'].map((name, i) =>
  canonicalizeRecipeFixture({
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    name,
    category: i === 2 ? 'Lunch' : 'Dinner',
  }),
);
const query = vi.hoisted(() => ({ isLoading: false, isError: false }));
vi.mock('@/hooks/use-recipes', () => ({
  useRecipes: () => ({ data: recipes, ...query, refetch: vi.fn() }),
}));
const submit = vi.fn();
const close = vi.fn();
function renderDialog() {
  return render(
    <SwapMealDialog
      open
      onOpenChange={close}
      recipe={recipes[0]}
      plannedRecipeIds={[recipes[0].id]}
      initialDayOfWeek={1}
      days={[
        { date: new Date(2026, 8, 28), dayName: 'Monday' },
        { date: new Date(2026, 8, 30), dayName: 'Wednesday' },
      ]}
      onSubmit={submit}
    />,
  );
}
beforeEach(() => {
  submit.mockReset();
  close.mockClear();
  query.isLoading = false;
  query.isError = false;
});
describe('Swap meal dialog', () => {
  it('disables planned recipes and searches across categories, submitting the chosen day', async () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: 'Swap with Soup' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Scheduled day'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Search recipes to swap'), {
      target: { value: 'lunch' },
    });
    expect(
      screen.queryByRole('button', { name: 'Swap with Salad' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Pasta' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(submit).toHaveBeenCalledExactlyOnceWith(recipes[2].id, 3);
  });
  it('keeps the selection open and shows a failed save inline', async () => {
    submit.mockRejectedValue(new Error('The plan changed.'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Salad' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The plan changed.'),
    );
    expect(close).not.toHaveBeenCalled();
  });
  it('prevents duplicate submission and dismissal while saving', async () => {
    let resolve!: () => void;
    submit.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    renderDialog();
    const button = screen.getByRole('button', { name: 'Swap with Salad' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(close).toHaveBeenCalledWith(false);
  });
  it('preserves a randomized same-category option', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Surprise me' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(recipes[1].id, 1));
  });
});
