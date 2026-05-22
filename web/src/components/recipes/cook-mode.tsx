'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChefHat,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getFlatRecipeInstructions } from '@/lib/recipe-structure';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { cn, toFraction } from '@/lib/utils';
import { getIngredientDisplayUnit } from '@/lib/ingredient-units';
import type { Recipe } from '@/types/database';

interface CookModeProps {
  recipe: Recipe;
  onClose: () => void;
}

export function CookMode({ recipe, onClose }: CookModeProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [checkedIngredients, setCheckedIngredients] =
    useState<Set<number>>(new Set());
  const [showIngredients, setShowIngredients] =
    useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const wakeLock = useWakeLock();
  const steps = getFlatRecipeInstructions(recipe);
  const ingredients = recipe.ingredients || [];
  const totalSteps = steps.length;

  // Request wake lock on mount
  useEffect(() => {
    wakeLock.request();
    return () => {
      wakeLock.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          setCurrentStep((s) =>
            Math.min(s + 1, totalSteps - 1)
          );
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          setCurrentStep((s) => Math.max(s - 1, 0));
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [totalSteps, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () =>
      window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll while cook mode is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const toggleIngredient = (index: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const cookModeContent = (
    <div className="fixed inset-0 z-[120] bg-background flex flex-col h-[100dvh] pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <ChefHat className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-bold text-primary truncate">
            {recipe.name}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0"
          aria-label="Exit cook mode"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Ingredient Checklist (collapsible) */}
      <div className="border-b border-border shrink-0">
        <button
          type="button"
          onClick={() =>
            setShowIngredients(!showIngredients)
          }
          className="w-full px-4 sm:px-6 py-3 flex items-center justify-between text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>
            Ingredients ({checkedIngredients.size}/
            {ingredients.length})
          </span>
          <ChevronRight
            className={cn(
              'h-4 w-4 transition-transform',
              showIngredients && 'rotate-90'
            )}
          />
        </button>
        {showIngredients && (
          <div className="px-4 sm:px-6 pb-4 max-h-48 overflow-y-auto">
            <ul className="space-y-2">
              {ingredients.map((ing, i) => {
                const displayUnit = getIngredientDisplayUnit(ing.unit);
                const quantityText = ing.amount != null
                  ? `${toFraction(ing.amount)}${displayUnit ? ` ${displayUnit}` : ''}`
                  : '';

                return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => toggleIngredient(i)}
                    className={cn(
                      'flex items-center gap-3 w-full',
                      'text-left text-sm py-1',
                      'transition-colors',
                      checkedIngredients.has(i) &&
                        'text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 h-5 rounded border-2',
                        'flex items-center justify-center',
                        'shrink-0 transition-colors',
                        checkedIngredients.has(i)
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground/40'
                      )}
                    >
                      {checkedIngredients.has(i) && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </span>
                    <span
                      className={cn(
                        checkedIngredients.has(i) &&
                          'line-through'
                      )}
                    >
                      {quantityText ? `${quantityText} ` : ''}
                      {ing.item}
                      {ing.alternatives && ing.alternatives.length > 0 && (
                        <span className="text-muted-foreground">
                          {' or '}
                          {ing.alternatives.join(' or ')}
                        </span>
                      )}
                      {ing.modifier && (
                        <span className="text-muted-foreground">
                          , {ing.modifier}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Step Content */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-12 py-8 overflow-y-auto">
        {totalSteps > 0 ? (
          <div className="max-w-2xl w-full text-center">
            <div className="mb-6">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-xl">
                {currentStep + 1}
              </span>
            </div>
            <p className="text-xl sm:text-2xl md:text-4xl leading-relaxed text-foreground font-medium">
              {steps[currentStep]}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-lg">
            No instructions available.
          </p>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-border shrink-0 gap-2 sm:gap-4">
        <Button
          variant="outline"
          onClick={() =>
            setCurrentStep((s) => Math.max(s - 1, 0))
          }
          disabled={currentStep === 0}
          className="min-h-11 sm:min-h-14 px-3 sm:px-6 text-sm sm:text-base"
        >
          <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" />
          Prev
        </Button>

        <span className="text-xs sm:text-sm text-muted-foreground font-medium whitespace-nowrap">
          {currentStep + 1} / {totalSteps}
        </span>

        <Button
          onClick={() => {
            if (currentStep < totalSteps - 1) {
              setCurrentStep((s) => s + 1);
            } else {
              onClose();
            }
          }}
          className="min-h-11 sm:min-h-14 px-3 sm:px-6 text-sm sm:text-base"
        >
          {currentStep < totalSteps - 1 ? (
            <>
              Next
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 ml-1 sm:ml-2" />
            </>
          ) : (
            'Done'
          )}
        </Button>
      </div>
    </div>
  );

  if (!isMounted) {
    return null;
  }

  return createPortal(cookModeContent, document.body);
}
