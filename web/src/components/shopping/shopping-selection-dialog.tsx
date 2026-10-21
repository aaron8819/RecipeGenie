'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePantryItems } from '@/hooks/use-pantry';
import type { PantryItem } from '@/types/database';
import { useShoppingDocumentState } from '@/hooks/shopping/use-shopping-document';
import {
  createSelectedShoppingEntry,
  initialShoppingSelection,
  shoppingSelectionReasons,
  type ShoppingRecipeSelection,
} from '@/lib/shopping-selection';
import {
  formatRecipeQuantity,
  getScalingBasis,
  getSelectedYieldText,
  RECIPE_QUANTITY_LIMITS,
} from '@/lib/recipe-quantity';
import { flattenRecipeIngredients } from '@/lib/recipe-structure';
import type { ShoppingDocumentV3 } from '@/lib/shopping-document';
import type { Recipe } from '@/types/database';
import { getErrorMessage } from '@/lib/utils';

interface ShoppingSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipes: Recipe[];
  defaultScale?: number;
  weekLabel?: string;
  onSubmit: (selections: ShoppingRecipeSelection[]) => Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}

export function ShoppingSelectionDialog(props: ShoppingSelectionDialogProps) {
  return props.open ? <OpenShoppingSelectionDialog {...props} /> : null;
}

function OpenShoppingSelectionDialog(props: ShoppingSelectionDialogProps) {
  const document = useShoppingDocumentState();
  const pantry = usePantryItems();
  const [review, setReview] = useState<{
    document: ShoppingDocumentV3;
    pantryItems: PantryItem[];
  } | null>(null);
  useEffect(() => {
    if (
      !document.isLoading &&
      !document.isError &&
      document.data &&
      !pantry.isLoading &&
      !pantry.isError &&
      pantry.data
    ) {
      const evidence = { document: document.data.document, pantryItems: pantry.data };
      setReview((current) => current ?? evidence);
    }
  }, [
    document.data,
    document.isLoading,
    document.isError,
    pantry.data,
    pantry.isLoading,
    pantry.isError,
  ]);
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent
        className="max-w-xl bg-shell p-6 sm:p-8"
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="font-display text-3xl font-semibold">
            {props.weekLabel ? 'Add week to shopping' : 'Add to shopping'}
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            Choose recipes, ingredients, and servings.
            {props.weekLabel && ` ${props.weekLabel}; cooked meals are included.`}
          </DialogDescription>
        </DialogHeader>
        {review ? (
          <>
            {(document.isError || pantry.isError) && (
              <p role="status" className="text-sm text-foreground/80">
                Saved data could not refresh. Your choices are preserved.
              </p>
            )}
            <SelectionForm {...props} document={review.document} pantryItems={review.pantryItems} />
          </>
        ) : document.isLoading || pantry.isLoading ? (
          <p role="status">Loading your saved selections…</p>
        ) : document.isError || !document.data || pantry.isError || !pantry.data ? (
          <div role="alert" className="space-y-3">
            <p>Could not load your shopping selections.</p>
            <Button
              className="h-11"
              onClick={() => {
                void document.refetch();
                void pantry.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <p role="status">Preparing your ingredient review.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelectionForm({
  recipes,
  document,
  pantryItems,
  defaultScale = 1,
  onSubmit,
  onOpenChange,
}: ShoppingSelectionDialogProps & {
  document: ShoppingDocumentV3;
  pantryItems: PantryItem[];
}) {
  // Freeze loaded evidence for this live review; refetches cannot reset user choices.
  const [reasons] = useState(() =>
    Object.fromEntries(
      recipes.map((recipe) => [recipe.id, shoppingSelectionReasons(recipe, document, pantryItems)]),
    ),
  );
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      recipes.map((recipe) => [
        recipe.id,
        {
          ...initialShoppingSelection(
            recipe,
            document.recipeEntries[recipe.id],
            defaultScale,
            reasons[recipe.id],
          ),
          enabled: true,
        },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const chosen = recipes.filter((recipe) => drafts[recipe.id]?.enabled);
  const selectedCount = chosen.reduce(
    (count, recipe) => count + drafts[recipe.id].selection.ingredientOrdinals.length,
    0,
  );
  let validationError: string | null = null;
  try {
    for (const recipe of chosen) createSelectedShoppingEntry(recipe, drafts[recipe.id].selection);
  } catch (error) {
    validationError = getErrorMessage(error, 'Review your ingredient selection.');
  }

  async function submit() {
    if (submitLock.current || !chosen.length || validationError) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(chosen.map((recipe) => drafts[recipe.id].selection));
      onOpenChange(false);
    } catch (error) {
      // The persistence hook also emits the application toast. Keep the dialog
      // open with its selections intact so the user can review or retry.
      setError(getErrorMessage(error, 'Could not add selected ingredients.'));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="text-xs text-foreground/80">
        Adding again updates that recipe’s ingredients and servings in Shopping. Other recipe
        selections and manual quantities stay unchanged. Matching purchases share visibility.
      </p>
      <div className="space-y-5">
        {recipes.map((recipe) => {
          const draft = drafts[recipe.id];
          const ingredients = flattenRecipeIngredients(recipe.ingredientSections);
          const basis = getScalingBasis(recipe.yield_metadata, recipe.servings);
          const validYield =
            Number.isSafeInteger(draft.selection.selectedYield) &&
            draft.selection.selectedYield > 0 &&
            draft.selection.selectedYield <= RECIPE_QUANTITY_LIMITS.selectedYield;
          const updateSelection = (changes: Partial<ShoppingRecipeSelection>) =>
            setDrafts((current) => ({
              ...current,
              [recipe.id]: {
                ...current[recipe.id],
                selection: { ...current[recipe.id].selection, ...changes },
              },
            }));
          return (
            <fieldset
              key={recipe.id}
              className="min-w-0 rounded-xl border border-border-warm bg-card p-4"
              disabled={submitting}
            >
              <legend className="px-2">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={draft.enabled}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [recipe.id]: {
                          ...current[recipe.id],
                          enabled: event.target.checked,
                        },
                      }))
                    }
                  />
                  {recipe.name}
                </label>
              </legend>
              {draft.notice && <p className="mb-3 text-sm text-foreground/80">{draft.notice}</p>}
              <label className="mb-3 flex min-h-11 flex-wrap items-center gap-3 text-xs text-foreground/80">
                {recipe.yield_metadata && recipe.yield_metadata.kind !== 'servings'
                  ? 'Yield'
                  : 'Servings'}
                <Input
                  type="number"
                  min={1}
                  max={RECIPE_QUANTITY_LIMITS.selectedYield}
                  step={1}
                  disabled={!draft.enabled}
                  aria-label={`Selected yield for ${recipe.name}`}
                  className="h-11 w-20 text-foreground"
                  value={draft.selection.selectedYield || ''}
                  onChange={(event) =>
                    updateSelection({
                      selectedYield: Number(event.target.value),
                    })
                  }
                />
                <span>
                  {validYield
                    ? getSelectedYieldText(
                        recipe.yield_metadata,
                        recipe.servings,
                        draft.selection.selectedYield,
                      )
                    : 'Enter a whole number from 1 to 100'}
                </span>
              </label>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p aria-live="polite" className="text-sm text-foreground/80">
                  {draft.selection.ingredientOrdinals.length} of {ingredients.length} selected
                </p>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  disabled={!draft.enabled}
                  onClick={() =>
                    updateSelection({
                      ingredientOrdinals:
                        draft.selection.ingredientOrdinals.length === ingredients.length
                          ? []
                          : ingredients.map((_, index) => index),
                    })
                  }
                >
                  {draft.selection.ingredientOrdinals.length === ingredients.length
                    ? 'Deselect all'
                    : 'Select all'}
                </Button>
              </div>
              {recipe.ingredientSections.map((section, sectionIndex) => (
                <div key={sectionIndex} className="mb-4 last:mb-0">
                  <h3 className="mb-2 text-sm font-semibold text-primary">
                    {section.label || 'Ingredients'}
                  </h3>
                  {section.ingredients.map((ingredient, localIndex) => {
                    const index =
                      recipe.ingredientSections
                        .slice(0, sectionIndex)
                        .reduce((count, section) => count + section.ingredients.length, 0) +
                      localIndex;
                    let quantity = 'Review yield';
                    if (validYield) {
                      try {
                        quantity = formatRecipeQuantity(
                          ingredient,
                          basis,
                          draft.selection.selectedYield,
                        ).text;
                      } catch {
                        quantity = 'Quantity cannot be scaled';
                      }
                    }
                    return (
                      <label
                        key={index}
                        className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-label={`${recipe.name}: ${ingredient.item}, ingredient ${index + 1}`}
                          disabled={!draft.enabled}
                          className="h-5 w-5 shrink-0 accent-primary"
                          checked={draft.selection.ingredientOrdinals.includes(index)}
                          onChange={(event) =>
                            updateSelection({
                              ingredientOrdinals: event.target.checked
                                ? [...draft.selection.ingredientOrdinals, index]
                                : draft.selection.ingredientOrdinals.filter(
                                    (ordinal) => ordinal !== index,
                                  ),
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          <span>{ingredient.item}</span>
                          {!!reasons[recipe.id][index]?.length && (
                            <span className="block text-xs text-foreground/80">
                              {reasons[recipe.id][index].join(' · ')}
                            </span>
                          )}
                          {ingredient.modifier && (
                            <span className="block text-xs text-foreground/80">
                              {ingredient.modifier}
                            </span>
                          )}
                          {!!ingredient.alternatives?.length && (
                            <span className="block text-xs text-foreground/80">
                              or {ingredient.alternatives.join(' or ')}
                            </span>
                          )}
                        </span>
                        <span className="max-w-[45%] text-right text-xs text-foreground/80">
                          {quantity}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </fieldset>
          );
        })}
      </div>
      {(error || validationError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || validationError}
        </p>
      )}
      <DialogFooter className="sticky -bottom-6 border-t border-border-warm bg-shell py-4 sm:-bottom-8">
        <Button
          variant="ghost"
          className="h-11 text-foreground"
          disabled={submitting}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          className="h-11"
          disabled={submitting || !chosen.length || Boolean(validationError)}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add {selectedCount} {selectedCount === 1 ? 'ingredient' : 'ingredients'}
        </Button>
      </DialogFooter>
    </>
  );
}
