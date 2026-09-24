import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShoppingItemRow, formatShoppingItemAmount } from '../shopping-list-components';
import { ShoppingAddItem, ShoppingRowControls, SelectionYield } from '../shopping-foundation-view';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { shoppingDocumentToList } from '@/lib/shopping-view';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { initializeShoppingDocument } from '@/lib/shopping-initialization';
import { parseQuantityV1 } from '@/lib/recipe-quantity';
import type { Recipe, ShoppingItem } from '@/types/database';

const command = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const addItem = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock('@/hooks/shopping/use-shopping-document', () => ({ useShoppingFoundationCommand: () => command, useAddShoppingItem: () => addItem }));
vi.mock('@/hooks/use-pantry', () => ({ usePantryItems: () => ({ isSuccess: true }) }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }));

const state = (): ShoppingDocumentStateV3 => ({ document: initializeShoppingDocument(createEmptyShoppingDocument(), []), contentRevision: 7 });
const item = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({ item: 'lemon', amount: 5, unit: 'count', categoryKey: 'produce', categoryOrder: 0, ...overrides });
function row(value: ShoppingItem) {
  const check = vi.fn();
  render(<ShoppingItemRow item={value} isDesktop={false} isCheckingOff={false} isRemoving={false} isAddingToPantry={false} recipeColorMap={new Map()} onCheckOff={check} onAddToPantry={vi.fn()} onRemove={vi.fn()} />);
  return check;
}

describe('Shopping presentation and relocated controls', () => {
  beforeEach(() => {
    command.mutateAsync.mockReset();
    addItem.mutateAsync.mockReset().mockResolvedValue({});
  });

  it('projects every recipe occurrence and exact manual source without changing the document', () => {
    const current = state();
    const recipe = canonicalizeRecipeFixture({ name: 'Salad', fixtureIngredients: [
      { item: 'lemon', amount: 1, unit: 'count' },
      { item: 'lemon', amount: 2, unit: 'count' },
    ] });
    current.document.recipeEntries[recipe.id] = createShoppingRecipeEntry(
      recipe, recipe.servings, { numerator: '1', denominator: '1' });
    current.document.manualItems.push({ id: 'extra', displayName: 'lemons',
      quantity: { amount: 0.5, unit: 'count', exactQuantityV1: parseQuantityV1('1/2') },
      categoryKey: 'produce', bucket: 'items', checked: false,
      identity: { purchaseKey: 'lemon', policyVersion: 'shopping-identity-2026-09-11', meaning: 'extra', version: 0 },
    });
    const original = structuredClone(current.document);
    const projected = shoppingDocumentToList('owner', current).items[0];
    expect(projected.requirementBreakdown).toHaveLength(3);
    expect(projected.requirementBreakdown?.map(part => part.quantity?.amount)).toEqual([1, 2, 0.5]);
    expect(projected.requirementBreakdown?.[2]).toMatchObject({ label: 'Added manually', manualId: 'extra', source: {
      originalItem: 'lemons', exactQuantityV1: { authored: '1/2' },
    } });
    expect(current.document).toEqual(original);
  });

  it('keeps all source occurrences and extras in one collapsed disclosure below the ingredient', () => {
    const check = row(item({ requirementBreakdown: [
      { label: 'Salad', quantity: { amount: 1, unit: 'count' }, hidden: false },
      { label: 'Chicken', quantity: { amount: 2, unit: 'count' }, hidden: false },
      { label: 'Added manually', manualId: 'extra', quantity: { amount: 2, unit: 'count' }, hidden: false },
      { label: 'Hidden soup', quantity: { amount: 3, unit: 'count' }, hidden: true },
    ] }));
    const disclosure = screen.getByLabelText('View sources for lemons');
    expect(disclosure.parentElement).not.toHaveAttribute('open');
    expect(screen.getByText('lemons').compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(disclosure);
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByText('1 lemon')).toBeInTheDocument();
    expect(screen.getAllByText('2 lemons')).toHaveLength(2);
    expect(screen.getByText('Added manually')).toBeInTheDocument();
    expect(screen.getByText(/not included above/)).toBeInTheDocument();
    expect(screen.queryByText(/Needs:|From |Recipe and extra breakdown/)).not.toBeInTheDocument();
  });

  it.each([null, 'to taste', 'as needed'])('hides an unspecified-only main amount (%s), preserving source and copy text', wording => {
    const quantity = { amount: null, unit: '', ...(wording ? { exactQuantityV1: parseQuantityV1(wording) } : {}) };
    const value = item({ item: 'basil', amount: null, unit: '', quantityParts: [quantity], requirementBreakdown: [{ label: 'Pasta', quantity, hidden: false }] });
    row(value);
    const primary = screen.getByText('basil').parentElement!;
    expect(primary.textContent).toBe('basil');
    expect(formatShoppingItemAmount(value)).toBe(wording ?? 'amount unspecified');
    expect(screen.getByText(`${wording ?? 'amount unspecified'} basil`)).toBeInTheDocument();
  });

  it('does not show a partial count for mixed known and unknown demand', () => {
    row(item({ quantityParts: [{ amount: 2, unit: 'count' }, { amount: null, unit: '' }] }));
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('hides a synthesized count when a source amount was unspecified', () => {
    row(item({ item: 'onion', amount: 3, unit: 'count', quantityParts: [{ amount: 3, unit: 'count' }],
      sources: [{ recipeId: 'recipe-1', recipeName: 'Soup', originalItem: 'onion', originalAmount: 2, originalUnit: 'count' },
        { recipeId: 'recipe-1', recipeName: 'Soup', originalItem: 'onion', originalAmount: null, originalUnit: '' }] }));
    expect(screen.getByText('onions').parentElement).not.toHaveTextContent('3');
  });

  it('keeps recipe measures in sources instead of the purchase row', () => {
    row(item({ item: 'broccoli', amount: 144, unit: 'tsp', quantityParts: [{ amount: 144, unit: 'tsp' }],
      requirementBreakdown: [{ label: 'Beef and Broccoli', quantity: { amount: 3, unit: 'cup' }, hidden: false }] }));
    expect(screen.getByText('broccoli').parentElement).toHaveTextContent('broccoli');
    expect(screen.getByText('broccoli').parentElement).not.toHaveTextContent('144 tsp');
    fireEvent.click(screen.getByText('View sources'));
    expect(screen.getByText('3 cup broccoli')).toBeVisible();
  });

  it('hides cheese teaspoons but shows whole produce and protein pounds', () => {
    row(item({ item: 'cheddar cheese', amount: 96, unit: 'tsp', quantityParts: [{ amount: 96, unit: 'tsp' }] }));
    row(item({ item: 'carrot', amount: 4, unit: 'count', quantityParts: [{ amount: 4, unit: 'count' }] }));
    row(item({ item: 'ground beef', amount: 1, unit: 'lb', quantityParts: [{ amount: 1, unit: 'lb' }] }));
    expect(screen.getByText('cheddar cheese').parentElement).not.toHaveTextContent('96 tsp');
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('1 lb')).toBeVisible();
  });

  it('adds a name without an amount control and returns focus', async () => {
    render(<ShoppingAddItem state={state()} />);
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'lemon' } });
    expect(screen.queryByRole('button', { name: 'Add an amount' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveFocus());
    expect(addItem.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ itemName: 'lemon' }));
  });

  it.each([
    ['zucchini, celery', ['zucchini', 'celery']],
    [' zucchini, , celery, basil, ', ['zucchini', 'celery', 'basil']],
  ])('adds comma-separated amount-free items individually in order: %s', async (text, names) => {
    render(<ShoppingAddItem state={state()} />);
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(addItem.mutateAsync).toHaveBeenCalledTimes(names.length));
    expect(addItem.mutateAsync.mock.calls.map(([value]) => value.itemName)).toEqual(names);
    expect(new Set(addItem.mutateAsync.mock.calls.map(([value]) => value.rowId)).size).toBe(names.length);
    expect(command.mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveValue(''));
  });

  it.each([
    ['Enter then Enter', 'enter', 'enter'],
    ['click then click', 'click', 'click'],
    ['Enter then click', 'enter', 'click'],
    ['click then Enter', 'click', 'enter'],
  ])('ignores rapid %s while a batch is in flight', async (_label, first, second) => {
    let finish!: () => void;
    addItem.mutateAsync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ShoppingAddItem state={state()} />);
    const input = screen.getByLabelText('Item name');
    fireEvent.change(input, { target: { value: 'turnip, yam' } });
    const form = input.closest('form')!;
    const submit = (kind: string) => kind === 'enter'
      ? fireEvent.submit(form)
      : fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    submit(first);
    submit(second);
    expect(addItem.mutateAsync).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(addItem.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled());
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('releases the guard after an uncertain result and keeps unresolved input', async () => {
    addItem.mutateAsync.mockRejectedValueOnce(new Error('Outcome unknown'));
    render(<ShoppingAddItem state={state()} />);
    const input = screen.getByLabelText('Item name');
    fireEvent.change(input, { target: { value: 'turnip, yam' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm turnip'));
    expect(input).toHaveValue('turnip, yam');
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled();
    expect(addItem.mutateAsync).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: 'new item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(addItem.mutateAsync).toHaveBeenCalledTimes(2));
  });

  it('releases the guard after a thrown single-item command', async () => {
    addItem.mutateAsync.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({});
    render(<ShoppingAddItem state={state()} />);
    const input = screen.getByLabelText('Item name');
    fireEvent.change(input, { target: { value: 'turnip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connection lost'));
    expect(input).toHaveValue('turnip');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(addItem.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('reports duplicates without losing a successful addition or unresolved name', async () => {
    addItem.mutateAsync.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Item already in shopping list')).mockResolvedValueOnce({});
    render(<ShoppingAddItem state={state()} />);
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'zucchini, celery, basil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(addItem.mutateAsync).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Added: zucchini, basil. Already on the list: celery.'));
    expect(screen.getByLabelText('Item name')).toHaveValue('celery');
  });

  it('stops after an uncertain result and retains that item and the unsubmitted remainder', async () => {
    addItem.mutateAsync.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Outcome unknown'));
    render(<ShoppingAddItem state={state()} />);
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'zucchini, celery, basil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm celery'));
    expect(addItem.mutateAsync.mock.calls.map(([value]) => value.itemName)).toEqual(['zucchini', 'celery']);
    expect(screen.getByRole('alert')).toHaveTextContent('Added: zucchini.');
    expect(screen.getByRole('alert')).toHaveTextContent('Review the list before retrying');
    expect(screen.getByLabelText('Item name')).toHaveValue('celery, basil');
  });


  it('places only the relevant manual editor on a row and keeps legacy resolution operable', () => {
    const current = state();
    current.document.manualItems = [{ id: 'legacy', displayName: 'lemon', quantity: { amount: 3, unit: 'count' }, categoryKey: 'produce', bucket: 'items', checked: false, identity: { purchaseKey: 'lemon', policyVersion: 'shopping-identity-2026-09-11', meaning: 'legacyIndependent', version: 1 } }];
    render(<ShoppingRowControls item={item({ rowId: 'manual:legacy' })} state={current} />);
    fireEvent.click(screen.getByText('Resolve legacy amount: lemon'));
    expect(screen.getByLabelText('Meaning for lemon')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove this legacy amount' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save independent amount' })).toBeVisible();
  });

  it('keeps yield validation and selection version binding in the relocated form', async () => {
    const current = state();
    const recipe = { id: 'recipe', name: 'Salad', servings: 2 } as Recipe;
    current.document.recipeEntries.recipe = { selectedServings: 2, scaleV1: { numerator: '1', denominator: '1' }, sourceEvidence: { version: 3 } } as typeof current.document.recipeEntries[string];
    render(<SelectionYield recipe={recipe} state={current} />);
    const form = screen.getByLabelText('Total Shopping yield for Salad').closest('form')!;
    fireEvent.change(within(form).getByLabelText('Total Shopping yield for Salad'), { target: { value: '0' } });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a positive');
  });
});
