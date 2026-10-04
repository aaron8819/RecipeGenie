import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DashboardShoppingRow } from '@/components/dashboard/dashboard-shopping-row';
import { ShoppingItemRow } from '@/components/shopping/shopping-list-components';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { createEmptyShoppingDocument, createShoppingRecipeEntry } from '../shopping-document';
import { initializeShoppingDocument } from '../shopping-initialization';
import { planShoppingCommand } from '../shopping-command-planner';
import { shoppingDocumentToList } from '../shopping-view';
import { parseIngredientLine } from '../recipe-parser';
import { formatShoppingPurchaseAmount, shoppingPurchaseDisplayName } from '../shopping-quantity-display';
import type { ShoppingItem } from '@/types/database';

afterEach(cleanup);

function purchase(...lines: string[]) {
  const recipes = lines.map((line, index) => canonicalizeRecipeFixture({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `Recipe ${index + 1}`, fixtureIngredients: [parseIngredientLine(line)],
  }));
  const document = initializeShoppingDocument(createEmptyShoppingDocument(), []);
  const captured = planShoppingCommand({ status: 'Pending',
    row: { document, content_revision: 0 }, dependencyRevision: '0', pantry: [],
    inverse: null, inverseRevision: null,
    recipes: recipes.map(recipe => ({ ...recipe, recipe_uuid: recipe.id,
      ingredient_sections: recipe.ingredientSections,
      instruction_sections: recipe.instructionSections })),
  }, { protocol: 1, observedRevision: 0, mutation: { type: 'upsertRecipes',
    entries: recipes.map(recipe => createShoppingRecipeEntry(recipe, 4,
      { numerator: '1', denominator: '1' })) } });
  expect(captured.outcome).toBe('Applied');
  const reloaded = JSON.parse(JSON.stringify(captured.document));
  const items = shoppingDocumentToList('owner', { document: reloaded, contentRevision: 1 }).items;
  expect(items).toHaveLength(1);
  return { item: items[0], document: reloaded };
}

describe('complete purchase quantities from captured package demand', () => {
  it.each([
    [['123 (14 ounce) cans beans', '2 cans beans'], '123 14 ounce cans + 2 cans'],
    [['2 (14 ounce) cans beans', '3 (14 ounce) cans beans'], '5 14 ounce cans'],
    [['2 (14 ounce) cans beans', '3 (14 oz) cans beans'], '5 14 ounce cans'],
    [['2 (14 ounce) cans beans', '3 (28 ounce) cans beans'], '2 14 ounce cans + 3 28 ounce cans'],
    [['1 (1 pound) can beans', '1 (16 ounce) can beans'], '1 1 pound can + 1 16 ounce can'],
    [['2 (14 ounce) cans beans', '3 (14 ounce) jars beans'], '2 14 ounce cans + 3 14 ounce jars'],
    [['123 (14 ounce) cans beans'], '123 14 ounce cans'],
    [['1/2 (14 ounce) can beans', '1/2 (14 ounce) can beans'], '1 14 ounce can'],
    [['1–2 (14 ounce) cans beans', '3 (14 ounce) cans beans'], '1–2 14 ounce cans + 3 14 ounce cans'],
    [['about 2 (14 ounce) cans beans', '3 (14 ounce) cans beans'], 'about 2 14 ounce cans + 3 14 ounce cans'],
    [['2 cans beans', '3 cans beans'], '2 cans + 3 cans'],
    [['2 carrots', '3 cups carrots'], 'See sources for quantities'],
    [['2 (14 ounce) cans beans', '100 g beans'], 'See sources for quantities'],
    [['2 lb beef', '3 oz beef'], 'See sources for quantities'],
  ])('preserves complete demand for %j', (lines, expected) => {
    const { item, document } = purchase(...lines);
    const snapshot = JSON.stringify({ item, document });
    expect(formatShoppingPurchaseAmount(item)).toBe(expected);
    expect(JSON.stringify({ item, document })).toBe(snapshot);
    expect(item.requirementBreakdown).toHaveLength(lines.length);
  });

  it.each([
    [['2 carrots'], '2'],
    [['6 eggs'], '6'],
    [['2 lb beef'], '2 lb'],
    [['As needed onion', '2 onions'], '3'],
    [['olive oil to taste'], ''],
    [['olive oil for garnish', '2 bottles olive oil'], ''],
    [['3 cups broccoli'], ''],
  ])('retains existing count, weight, estimate and qualitative behavior for %j', (lines, amount) => {
    expect(formatShoppingPurchaseAmount(purchase(...lines).item)).toBe(amount);
  });

  it('does not label a sources fallback as an estimated total', () => {
    const { item } = purchase('As needed onion', '2 cups onion');
    expect(formatShoppingPurchaseAmount(item)).toBe('See sources for quantities');
    expect(shoppingPurchaseDisplayName(item)).not.toContain('(estimate)');
  });

  it('keeps mixed manual quantities visible without pointing to an absent Sources control', () => {
    const item: ShoppingItem = { item: 'beans', rowId: 'derived:beans', amount: 2, unit: 'can',
      categoryKey: 'pantry', categoryOrder: 5,
      quantityParts: [{ amount: 2, unit: 'can' }, { amount: 100, unit: 'g' }],
      sources: [{ manualId: 'one', recipeName: 'Manual' }, { manualId: 'two', recipeName: 'Manual' }] };
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={vi.fn()} />);
    expect(container.querySelector('.shopping-purchase-amount')).toHaveTextContent('2 cans + 100 g');
    expect(container.querySelector('details')).toBeNull();
  });

  it.each(['dashboard', 'shopping'] as const)('shows all package demand and unchanged exact sources in %s', surface => {
    const { item, document } = purchase('123 (14 ounce) cans beans', '2 cans beans');
    const snapshot = JSON.stringify({ item, document });
    const check = vi.fn();
    const { container } = render(surface === 'dashboard'
      ? <DashboardShoppingRow item={item} onCheckOff={check} />
      : <ShoppingItemRow item={item} isDesktop={false} isCheckingOff={false}
        isRemoving={false} isAddingToPantry={false} recipeColorMap={new Map()}
        onCheckOff={check} onRemove={vi.fn()} onAddToPantry={vi.fn()} />);
    expect(container.querySelector('.shopping-purchase-amount')).toHaveTextContent('123 14 ounce cans + 2 cans');
    fireEvent.click(screen.getByLabelText('View sources for beans'));
    const sources = surface === 'dashboard' ? container.querySelector('details')! : screen.getByRole('dialog');
    expect(sources).toHaveTextContent('123 14 ounce cans beans — Recipe 1');
    expect(sources).toHaveTextContent('2 cans beans — Recipe 2');
    expect(check).not.toHaveBeenCalled();
    expect(JSON.stringify({ item, document })).toBe(snapshot);
  });

  it('keeps repeated matching package sources separate after combining the headline', () => {
    const { item } = purchase('2 (14 ounce) cans beans', '3 (14 ounce) cans beans');
    const { container } = render(<DashboardShoppingRow item={item} onCheckOff={vi.fn()} />);
    expect(container.querySelector('.shopping-purchase-amount')).toHaveTextContent('5 14 ounce cans');
    fireEvent.click(screen.getByLabelText('View sources for beans'));
    expect(container.querySelector('details')).toHaveTextContent('2 14 ounce cans beans — Recipe 1');
    expect(container.querySelector('details')).toHaveTextContent('3 14 ounce cans beans — Recipe 2');
  });
});
