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
  function open() {
    render(
      <ShoppingSelectionDialog
        open
        onOpenChange={onOpenChange}
        recipes={[recipe]}
        onSubmit={onSubmit}
      />,
    );
  }

  it('submits a source subset at the selected yield, then closes', async () => {
    open();
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
    open();
    expect(screen.getByLabelText('Soup: milk, ingredient 1')).not.toBeChecked();
    expect(
      screen.getByLabelText('Soup: olive oil, ingredient 2'),
    ).toBeChecked();
    expect(screen.getByLabelText('Selected yield for Soup')).toHaveValue(8);
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
