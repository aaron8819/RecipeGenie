'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ChefHat, ShoppingCart } from 'lucide-react';
import { usePantryMatch } from '@/hooks/use-pantry-match';
import { useAddToShoppingList } from '@/hooks/use-shopping';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { cn } from '@/lib/utils';
import { getTagClassName } from '@/lib/tag-colors';

interface WhatCanIMakeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatCanIMake({
  open,
  onOpenChange,
}: WhatCanIMakeProps) {
  const { matches, isLoading } = usePantryMatch();
  const addToShoppingList = useAddToShoppingList();
  const undoToast = useUndoToast();
  const [filter, setFilter] = useState<
    'all' | 'canMake'
  >('all');
  const [addingId, setAddingId] = useState<string | null>(
    null
  );

  const filtered =
    filter === 'canMake'
      ? matches.filter((m) => m.matchPercentage === 100)
      : matches;

  const handleAddMissing = async (
    recipeId: string,
    recipeName: string
  ) => {
    setAddingId(recipeId);
    try {
      const result = await addToShoppingList.mutateAsync({
        recipeIds: [recipeId],
        scale: 1.0,
      });
      const count = result.added + result.merged;
      undoToast.show({
        message: `Added ${count} ingredient${count !== 1 ? 's' : ''} from "${recipeName}" to shopping list`,
      });
    } catch {
      undoToast.show({
        message: 'Failed to add to shopping list',
      });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogTitle className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-primary" />
          What Can I Make?
        </DialogTitle>

        {/* Filter toggles */}
        <div className="flex gap-2 py-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className="rounded-full"
          >
            All ({matches.length})
          </Button>
          <Button
            variant={
              filter === 'canMake' ? 'default' : 'outline'
            }
            size="sm"
            onClick={() => setFilter('canMake')}
            className="rounded-full"
          >
            Can Make Now (
            {
              matches.filter(
                (m) => m.matchPercentage === 100
              ).length
            }
            )
          </Button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              {filter === 'canMake'
                ? 'No recipes can be made with pantry items alone. Try "All" to see partial matches.'
                : 'No matching recipes found. Add more items to your pantry.'}
            </p>
          ) : (
            filtered.map((match) => (
              <div
                key={match.recipe.id}
                className="border rounded-lg p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {match.recipe.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={cn(
                          'px-2 py-0.5 text-xs font-medium rounded-full capitalize',
                          getTagClassName(
                            match.recipe.category,
                            true
                          )
                        )}
                      >
                        {match.recipe.category}
                      </span>
                      {match.missingIngredients.length >
                        0 && (
                        <span className="text-xs text-muted-foreground">
                          Missing{' '}
                          {match.missingIngredients.length}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Match percentage bar */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={cn(
                        'text-sm font-bold',
                        match.matchPercentage === 100
                          ? 'text-green-600 dark:text-green-400'
                          : match.matchPercentage >= 75
                            ? 'text-primary'
                            : 'text-muted-foreground'
                      )}
                    >
                      {match.matchPercentage}%
                    </span>
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          match.matchPercentage === 100
                            ? 'bg-green-500'
                            : match.matchPercentage >= 75
                              ? 'bg-primary'
                              : 'bg-muted-foreground/50'
                        )}
                        style={{
                          width: `${match.matchPercentage}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Missing ingredients */}
                {match.missingIngredients.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground truncate">
                      Need:{' '}
                      {match.missingIngredients
                        .map((i) => i.item)
                        .join(', ')}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleAddMissing(
                          match.recipe.id,
                          match.recipe.name
                        )
                      }
                      disabled={
                        addingId === match.recipe.id
                      }
                      className="shrink-0 text-xs"
                    >
                      {addingId === match.recipe.id ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <ShoppingCart className="h-3 w-3 mr-1" />
                      )}
                      Add to list
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
