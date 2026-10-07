import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShoppingSelectionDialog } from '../shopping-selection-dialog';
import { createEmptyShoppingDocument } from '@/lib/shopping-document';
import {
  initialShoppingSelection,
  createSelectedShoppingEntry,
} from '@/lib/shopping-selection';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { parseIngredientLine } from '@/lib/recipe-parser';

let document = createEmptyShoppingDocument();
vi.mock('@/hooks/shopping/use-shopping-document', () => ({
  useShoppingDocumentState: () => ({
    data: { document },
    isLoading: false,
    isError: false,
  }),
}));
const recipe = canonicalizeRecipeFixture({
  name: 'Soup',
  fixtureIngredients: ['1 cup milk', '2 tbsp olive oil'].map(
    parseIngredientLine,
  ),
});
const onSubmit = vi.fn();
const onOpenChange = vi.fn();

describe('Shopping selection dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document = createEmptyShoppingDocument();
    onSubmit.mockResolvedValue(undefined);
  });
  function open(defaultScale = 1) {
    render(
      <ShoppingSelectionDialog
        open
        onOpenChange={onOpenChange}
        recipes={[recipe]}
        onSubmit={onSubmit}
        defaultScale={defaultScale}
      />,
    );
  }

  it('submits a source subset at the selected yield, then closes', async () => {
    open(2);
    fireEvent.change(screen.getByLabelText('Selected yield for Soup'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByLabelText('Soup: olive oil, ingredient 2'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add selected ingredients' }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({
        recipeId: recipe.id,
        selectedYield: 8,
        ingredientOrdinals: [0],
      }),
    ]);
  });

  it('requires ingredients and a valid whole-number yield', () => {
    open();
    fireEvent.click(screen.getByLabelText('Soup: milk, ingredient 1'));
    fireEvent.click(screen.getByLabelText('Soup: olive oil, ingredient 2'));
    expect(
      screen.getByRole('button', { name: 'Add selected ingredients' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Soup: milk, ingredient 1'));
    fireEvent.change(screen.getByLabelText('Selected yield for Soup'), {
      target: { value: '1.5' },
    });
    expect(
      screen.getByRole('button', { name: 'Add selected ingredients' }),
    ).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('restores an existing contribution instead of silently adding all ingredients', () => {
    document.recipeEntries[recipe.id] = createSelectedShoppingEntry(recipe, {
      ...initialShoppingSelection(recipe).selection,
      selectedYield: 8,
      ingredientOrdinals: [1],
    });
    open(3);
    expect(screen.getByLabelText('Soup: milk, ingredient 1')).not.toBeChecked();
    expect(
      screen.getByLabelText('Soup: olive oil, ingredient 2'),
    ).toBeChecked();
    expect(screen.getByLabelText('Selected yield for Soup')).toHaveValue(8);
  });

  it('selects and deselects canonical occurrences across repeated groups', async () => {
    const grouped = { ...recipe, ingredientSections: [
      { label: 'Sauce', ingredients: [{ ...recipe.ingredientSections[0].ingredients[0], modifier: 'finely chopped', alternatives: ['oat milk'] }] },
      { label: 'Sauce', ingredients: [recipe.ingredientSections[0].ingredients[0]] },
    ] };
    render(<ShoppingSelectionDialog open onOpenChange={onOpenChange} recipes={[grouped]} onSubmit={onSubmit} />);
    expect(screen.getAllByRole('heading', { name: 'Sauce' })).toHaveLength(2);
    expect(screen.getByText('finely chopped')).toBeInTheDocument();
    expect(screen.getByText('or oat milk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(screen.getByText('0 of 2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selected ingredients' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByLabelText('Soup: milk, ingredient 1'));
    expect(screen.getByLabelText('Soup: milk, ingredient 2')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add selected ingredients' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({ ingredientOrdinals: [1] })]));
  });

  it('keeps selections and shows a failed save for retry', async () => {
    onSubmit.mockRejectedValueOnce(
      new Error('Shopping changed in another session.'),
    );
    open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add selected ingredients' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Shopping changed'),
    );
    expect(screen.getByLabelText('Soup: milk, ingredient 1')).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
