import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DashboardShoppingRow } from '../dashboard-shopping-row';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { createEmptyShoppingDocument, createShoppingRecipeEntry } from '@/lib/shopping-document';
import { shoppingDocumentToList } from '@/lib/shopping-view';
import { parseQuantityV1 } from '@/lib/recipe-quantity';
import type { Ingredient, ShoppingItem } from '@/types/database';

afterEach(cleanup);

function recipeItem(ingredients: Ingredient[]): ShoppingItem {
  const recipe = canonicalizeRecipeFixture({ name: 'Dinner soup', fixtureIngredients: ingredients });
  const document = createEmptyShoppingDocument();
  document.recipeEntries[recipe.id] = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' });
  return shoppingDocumentToList('owner', { document, contentRevision: 0 }).items[0];
}

describe('Dashboard purchase rows', () => {
  it('shows only the name for an unspecified manual item, with one checkbox and no sources', () => {
    const item: ShoppingItem = { item: 'deli turkey', amount: null, unit: '', rowId: 'manual:one', categoryKey: 'protein', categoryOrder: 1 };
    const onCheckOff = vi.fn();
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={onCheckOff} />);
    expect(container.textContent).toBe('deli turkey');
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByText('deli turkey'));
    expect(onCheckOff).toHaveBeenCalledWith(item);
  });

  it.each([
    ['carrot', 2, '', '2 carrots'],
    ['beans', 2, 'can', '2 cans beans'],
    ['ground beef', 2, 'lb', '2 lb ground beef'],
    ['onion', null, '', '1 onion (estimate)'],
    ['olive oil', null, '', 'olive oil'],
  ] as const)('uses purchase display for %s without altering captured sources', (name, amount, unit, display) => {
    const item = recipeItem([{ item: name, amount, unit,
      ...(amount === null ? { quantityV1: parseQuantityV1('As needed')! } : {}) }]);
    const snapshot = JSON.stringify(item);
    const onCheckOff = vi.fn();
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={onCheckOff} />);
    const primary = container.querySelector('.dashboard-shopping-name')!;
    const estimated = display.includes('(estimate)');
    const expectedName = display.replace(/^(?:2 cans |2 lb |2 |1 )/, '').replace(/ \(estimate\)$/, '');
    expect(primary).toHaveTextContent(expectedName);
    expect(primary.querySelector('small')?.textContent ?? '').toBe(estimated ? 'estimate' : '');
    const expectedAmount = display.match(/^(2 cans|2 lb|2|1) /)?.[1] ?? '';
    expect(primary.querySelector('.shopping-purchase-amount')?.firstChild?.textContent ?? '').toBe(expectedAmount);
    expect(primary).not.toHaveTextContent(/amount unspecified|As needed/);
    fireEvent.click(screen.getByText('Sources'));
    expect(onCheckOff).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Dinner soup');
    if (amount === null) expect(container.textContent?.toLowerCase()).toContain('as needed');
    expect(JSON.stringify(item)).toBe(snapshot);
  });

  it('retains every recipe and manual source in mixed demand', () => {
    const item = recipeItem([{ item: 'carrot', amount: 2, unit: '' }]);
    item.sources = [...item.sources!, { ...item.sources![0], recipeId: 'second', recipeName: 'Lunch salad', label: 'Lunch salad' },
      { recipeName: 'Added manually', manualId: 'manual-one', originalAmount: 1, originalUnit: '' }];
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={vi.fn()} />);
    fireEvent.click(screen.getByText('Sources'));
    expect(container.textContent).toContain('Dinner soup');
    expect(container.textContent).toContain('Lunch salad');
    expect(container.textContent).toContain('Added manually');
  });

  it.each(['to taste', 'for garnish', 'as needed'])('keeps qualitative %s in the inline source only', wording => {
    const item = recipeItem([{ item: 'basil', amount: null, unit: '', quantityV1: parseQuantityV1(wording)! }]);
    const onCheckOff = vi.fn();
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={onCheckOff} />);
    expect(container.querySelector('.dashboard-shopping-name')).toHaveTextContent(/^basil$/);
    const disclosure = screen.getByLabelText('View sources for basil');
    expect(disclosure.tagName).toBe('SUMMARY');
    expect(disclosure.closest('label')).toBeNull();
    fireEvent.click(disclosure);
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(container.querySelector('details')).toHaveTextContent(new RegExp(wording, 'i'));
    fireEvent.click(disclosure);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(onCheckOff).not.toHaveBeenCalled();
  });

  it('preserves exact occurrences, extra demand, and hidden-source distinctions', () => {
    const item = recipeItem([{ item: 'carrot', amount: 2, unit: '' }]);
    item.requirementBreakdown = [
      { label: 'Soup (1)', source: { ...item.sources![0], originalAmount: 0.5, exactQuantityV1: parseQuantityV1('1/2')! }, quantity: null, hidden: false },
      { label: 'Soup (2)', source: { ...item.sources![0], originalAmount: 1, exactQuantityV1: parseQuantityV1('1')! }, quantity: null, hidden: true },
      { label: 'Added manually', manualId: 'extra', source: { manualId: 'extra', recipeName: 'Manual', originalItem: 'carrot', originalAmount: 2, originalUnit: '' }, quantity: null, hidden: false },
    ];
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={vi.fn()} />);
    fireEvent.click(screen.getByText('Sources'));
    expect(container.querySelector('details')).toHaveTextContent('½ carrots — Soup (1)');
    expect(container.querySelector('details')).toHaveTextContent('1 carrot — Soup (2) (not included above: hidden or in Pantry)');
    expect(container.querySelector('details')).toHaveTextContent('2 carrots — Added manually');
  });

  it('keeps measured recipe demand in sources without a misleading purchase total', () => {
    const item = recipeItem([{ item: 'broccoli', amount: 3, unit: 'cup' }]);
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={vi.fn()} />);
    expect(container.querySelector('.dashboard-shopping-name')).toHaveTextContent(/^broccoli$/);
    fireEvent.click(screen.getByText('Sources'));
    expect(container.querySelector('details')).toHaveTextContent('3 cups broccoli');
  });
});
