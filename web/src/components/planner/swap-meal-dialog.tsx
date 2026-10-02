'use client';

import { useRef, useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useRecipes } from '@/hooks/use-recipes';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSwapRecipe } from '@/lib/meal-planner';
import { getErrorMessage } from '@/lib/utils';
import type { Recipe } from '@/types/database';

interface SwapMealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe;
  plannedRecipeIds: string[];
  days: { date: Date; dayName: string }[];
  initialDayOfWeek: number;
  onSubmit: (replacementRecipeId: string, dayOfWeek: number) => Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}

export function SwapMealDialog(props: SwapMealDialogProps) {
  return props.open ? <OpenSwapMealDialog {...props} /> : null;
}

function OpenSwapMealDialog({
  onOpenChange,
  recipe,
  plannedRecipeIds,
  days,
  initialDayOfWeek,
  onSubmit,
  onCloseAutoFocus,
}: SwapMealDialogProps) {
  const { data: recipes, isLoading, isError, refetch } = useRecipes();
  const [search, setSearch] = useState('');
  const [day, setDay] = useState(initialDayOfWeek);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const planned = new Set(plannedRecipeIds);
  const matches = (recipes || []).filter((candidate) =>
    `${candidate.name} ${candidate.category}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const randomAvailable = (recipes || []).some(
    (candidate) =>
      candidate.category === recipe.category && !planned.has(candidate.id),
  );

  async function submit(id: string) {
    if (lock.current || planned.has(id)) return;
    lock.current = true;
    setPending(id);
    setError(null);
    try {
      await onSubmit(id, day);
      onOpenChange(false);
    } catch (error) {
      setError(
        getErrorMessage(error, 'Could not swap this meal. Please try again.'),
      );
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!lock.current) onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[90dvh] flex flex-col overflow-hidden bg-shell p-6 sm:p-8"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle className="font-display text-3xl font-semibold">
            Swap meal
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            Choose a recipe to replace {recipe.name}.
          </DialogDescription>
        </DialogHeader>
        <label className="shrink-0 space-y-2 text-sm">
          <span>Scheduled day</span>
          <select
            aria-label="Scheduled day"
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
            disabled={pending !== null}
            className="h-11 w-full rounded-lg border border-border-warm bg-card px-3 text-foreground"
          >
            {days.map(({ date, dayName }) => (
              <option key={date.getDay()} value={date.getDay()}>
                {dayName},{' '}
                {date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="Search recipes to swap"
          placeholder="Search recipes…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={pending !== null}
          className="h-11 shrink-0"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="swap-meal-results"
        >
          {isLoading ? (
            <p role="status">Loading recipes…</p>
          ) : isError ? (
            <div role="alert">
              <p>Could not load recipes.</p>
              <Button className="h-11" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border-warm">
              {!matches.length && (
                <p className="py-4 text-sm">No recipes match your search.</p>
              )}
              {matches.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={planned.has(candidate.id) || pending !== null}
                  onClick={() => void submit(candidate.id)}
                  aria-label={`Swap with ${candidate.name}`}
                  className="flex min-h-16 w-full items-center gap-3 py-3 text-left hover:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{candidate.name}</span>
                    <span className="block text-xs text-foreground/80">
                      {candidate.servings} servings · {candidate.category}
                      {planned.has(candidate.id)
                        ? ' · Already planned this week'
                        : ''}
                    </span>
                  </span>
                  {pending === candidate.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-border-warm bg-shell pt-4">
          <Button
            variant="ghost"
            className="h-11 text-foreground"
            disabled={pending !== null}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={!randomAvailable || pending !== null}
            onClick={() => {
              const replacement = getSwapRecipe(
                recipes || [],
                recipe.category,
                plannedRecipeIds,
              );
              if (replacement) void submit(replacement.id);
            }}
          >
            Surprise me
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
