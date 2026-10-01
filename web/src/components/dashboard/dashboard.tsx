'use client';

import { useRef, useState } from 'react';
import { DashboardMealImage } from './dashboard-meal-image';
import Link from 'next/link';
import { Check, MoreHorizontal, Plus, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AddRecipeToPlanModal } from '@/components/planner/add-recipe-to-plan-modal';
import { SwapMealDialog } from '@/components/planner/swap-meal-dialog';
import { ShoppingSelectionDialog } from '@/components/shopping/shopping-selection-dialog';
import { formatShoppingItemAmount } from '@/components/shopping/shopping-list-components';
import {
  groupRecipesByPlannerDay,
  isRecipeMadeForWeek,
  normalizeStoredDayAssignments,
} from '@/components/planner/meal-planner.selectors';
import {
  getWeekDays,
  getWeekStartDate,
} from '@/components/planner/meal-planner.utils';
import {
  useUserConfig,
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useRecentRecipeHistory,
  useMarkRecipeMade,
  useRemoveRecipeFromPlan,
  useAddRecipeToPlan,
  useSaveDayAssignments,
} from '@/hooks/use-planner';
import {
  useShoppingList,
  useAddShoppingItem,
  useAddToShoppingList,
} from '@/hooks/use-shopping';
import { useShoppingCheckIntents } from '@/hooks/use-shopping-check-intents';
import { useReplacePlannedRecipe } from '@/hooks/use-replace-planned-recipe';
import { useLocalCalendarDate } from '@/hooks/use-local-calendar-date';
import { useUndoToast } from '@/hooks/use-undo-toast';
import {
  buildUnassignedDayPriority,
  parseLocalDate,
  toLocalNoonISOString,
} from '@/lib/planner-utils';
import { buildPlannerHref } from '@/lib/planner-route-state';
import { buildRecipeDetailHref } from '@/lib/recipe-detail-navigation';
import { getRecipeImageUrl } from '@/lib/supabase/storage';
import { addShoppingDraft } from '@/lib/shopping-quick-add';
import { formatShoppingAddMessage } from '@/lib/shopping-feedback';
import type { ShoppingRecipeSelection } from '@/lib/shopping-selection';
import { getErrorMessage } from '@/lib/utils';
import type { Recipe } from '@/types/database';
import './dashboard.css';

function QueryState({
  loading,
  retry,
}: {
  loading: boolean;
  retry: () => void;
}) {
  return loading ? (
    <p role="status" className="dashboard-empty">
      Loading…
    </p>
  ) : (
    <div role="alert" className="dashboard-empty">
      <p>Could not load this section.</p>
      <Button className="min-h-11" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

function MealMenu({
  recipe,
  cooked,
  pending,
  onAction,
}: {
  recipe: Recipe;
  cooked: boolean;
  pending: boolean;
  onAction: (
    action: 'swap' | 'shopping' | 'move' | 'remove',
    recipe: Recipe,
    trigger: HTMLButtonElement | null,
  ) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedAction = useRef<Parameters<typeof onAction>[0] | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-11 w-11 shrink-0 p-0"
          disabled={pending}
          ref={trigger}
          aria-label={`Meal actions for ${recipe.name}`}
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const action = selectedAction.current;
          selectedAction.current = null;
          if (action) {
            event.preventDefault();
            onAction(action, recipe, trigger.current);
          }
        }}
      >
        <DropdownMenuItem
          className="min-h-11"
          disabled={cooked}
          onSelect={() => { selectedAction.current = 'swap'; }}
        >
          Swap meal
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          disabled={cooked}
          onSelect={() => { selectedAction.current = 'shopping'; }}
        >
          Add to shopping
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          onSelect={() => { selectedAction.current = 'move'; }}
        >
          Move to another day
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 text-destructive"
          onSelect={() => { selectedAction.current = 'remove'; }}
        >
          Remove from plan
        </DropdownMenuItem>
        {cooked && (
          <p className="max-w-64 px-2 py-2 text-xs text-muted-foreground">
            Cooked meals can be moved or removed.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShoppingPreview() {
  const shopping = useShoppingList();
  const add = useAddShoppingItem();
  const { pendingCheckIntents, handleCheckOff } = useShoppingCheckIntents();
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [adding, setAdding] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const items = (shopping.data?.items || []).map((item) => {
    const intent = item.rowId ? pendingCheckIntents.get(item.rowId) : undefined;
    return intent ? { ...item, checked: intent.checked } : item;
  });
  const remaining = items.filter((item) => !item.checked);
  // Pending rows stay actionable for a rapid reversal, as on the full list.
  const preview = items
    .filter(
      (item) =>
        !item.checked || (item.rowId && pendingCheckIntents.has(item.rowId)),
    )
    .slice(0, 5);
  const hiddenCount =
    remaining.length - preview.filter((item) => !item.checked).length;
  const ready = !shopping.isLoading && !shopping.isError && !!shopping.data;

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!draft.trim()) {
      setFeedback('Enter an item or paste a comma-separated list.');
      input.current?.focus();
      return;
    }
    lock.current = true;
    setAdding(true);
    try {
      const result = await addShoppingDraft(draft, (item) =>
        add.mutateAsync(item),
      );
      setDraft(result.draft);
      setFeedback(result.message);
    } finally {
      lock.current = false;
      setAdding(false);
      input.current?.focus();
    }
  }

  return (
    <section
      className="dashboard-shopping"
      aria-labelledby="dashboard-shopping-title"
    >
      <div className="dashboard-section-heading">
        <div>
          <h2 id="dashboard-shopping-title">Shopping</h2>
          {ready && (
            <p>
              {remaining.length} {remaining.length === 1 ? 'item' : 'items'}{' '}
              remaining
            </p>
          )}
        </div>
        <Link className="dashboard-link" href="/shopping">
          View all →
        </Link>
      </div>
      {!ready ? (
        <QueryState
          loading={shopping.isLoading}
          retry={() => void shopping.refetch()}
        />
      ) : (
        <>
          <form className="dashboard-quick-add" onSubmit={quickAdd}>
            <Input
              ref={input}
              aria-label="Quick add shopping items"
              placeholder="Add an item…"
              value={draft}
              readOnly={adding}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              variant="ghost"
              className="h-11 w-11 shrink-0 p-0"
              disabled={adding}
              aria-label="Add shopping items"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </form>
          {feedback && (
            <p role="status" className="mb-3 text-sm">
              {feedback}
            </p>
          )}
          <div className="dashboard-shopping-items">
            {preview.map((item) => (
              <label key={item.rowId} className="dashboard-shopping-row">
                <input
                  type="checkbox"
                  checked={!!item.checked}
                  onChange={() => handleCheckOff(item)}
                  aria-label={`Check off ${item.item}`}
                />
                <span>
                  <span className={item.checked ? 'line-through' : ''}>
                    {item.item}
                  </span>
                  <small>{formatShoppingItemAmount(item) || 'As needed'}</small>
                </span>
              </label>
            ))}
          </div>
          {!remaining.length && (
            <div className="dashboard-empty">
              <p>
                {items.length
                  ? 'All shopping completed'
                  : 'Your shopping list is empty'}
              </p>
              <Link className="dashboard-link" href="/shopping">
                View list →
              </Link>
            </div>
          )}
          {hiddenCount > 0 && (
            <Link className="dashboard-more" href="/shopping">
              + {hiddenCount} more items · View list
            </Link>
          )}
          <p className="dashboard-note">Add items or check them off here.</p>
        </>
      )}
    </section>
  );
}

export function Dashboard() {
  const today = useLocalCalendarDate();
  if (!today) return <p role="status">Loading dashboard…</p>;
  return <DashboardForDate key={today} today={today} />;
}

function DashboardForDate({ today }: { today: string }) {
  const config = useUserConfig();
  const weekStartDay = config.data?.week_start_day ?? 1;
  const week = config.isSuccess
    ? getWeekStartDate(parseLocalDate(today), weekStartDay)
    : '';
  // A week change remounts dialog state, preventing actions against the prior week.
  return (
    <DashboardWeek
      key={week}
      today={today}
      week={week}
      weekStartDay={weekStartDay}
      config={config}
    />
  );
}

function DashboardWeek({
  today,
  week,
  weekStartDay,
  config,
}: {
  today: string;
  week: string;
  weekStartDay: number;
  config: ReturnType<typeof useUserConfig>;
}) {
  const plan = useWeeklyPlan(week);
  const recipes = useWeeklyPlanRecipes(plan.data?.recipe_ids || []);
  const history = useRecentRecipeHistory();
  const mark = useMarkRecipeMade();
  const remove = useRemoveRecipeFromPlan();
  const restore = useAddRecipeToPlan();
  const move = useSaveDayAssignments();
  const replace = useReplacePlannedRecipe();
  const shoppingAdd = useAddToShoppingList();
  const toast = useUndoToast();
  const [addDay, setAddDay] = useState<number | null>(null);
  const [swap, setSwap] = useState<{
    recipe: Recipe;
    expectedDay: number | null;
    day: number;
  } | null>(null);
  const [moving, setMoving] = useState<Recipe | null>(null);
  const [moveDay, setMoveDay] = useState(0);
  const [shopping, setShopping] = useState<{
    recipes: Recipe[];
    weekly: boolean;
  } | null>(null);
  const [pending, setPending] = useState(new Set<string>());
  const locks = useRef(new Set<string>());
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const todayHeading = useRef<HTMLHeadingElement>(null);
  const addSucceeded = useRef(false);
  const addFocusFallback = useRef<HTMLHeadingElement | null>(null);
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    if (dialogTrigger.current?.isConnected && !dialogTrigger.current.disabled) dialogTrigger.current.focus();
    else heading.current?.focus();
  }
  function openAdd(day: number, trigger: HTMLButtonElement) {
    addSucceeded.current = false;
    addFocusFallback.current = trigger.closest('section')?.querySelector('h2') ?? null;
    dialogTrigger.current = trigger;
    setAddDay(day);
  }
  const days = week ? getWeekDays(week) : [];
  const lastMade = new Map<string, string>();
  for (const entry of history.data || [])
    if (!lastMade.has(entry.recipe_id))
      lastMade.set(entry.recipe_id, entry.date_made);
  const assignments = {
    ...normalizeStoredDayAssignments({
      storedAssignments: {
        version: 2,
        weeks: { [week]: plan.data?.day_assignments },
      },
      currentWeekDate: week,
      weekStartDay,
    }),
  };
  const grouped = groupRecipesByPlannerDay({
    recipes: recipes.data,
    recipeDayAssignments: assignments,
    weekDayNumbers: days.map((day) => day.date.getDay()),
    unassignedDayPriority: buildUnassignedDayPriority(
      config.data?.excluded_days || [],
      config.data?.preferred_days,
    ),
  });
  const todayIndex = days.findIndex(
    (day) => day.date.toDateString() === parseLocalDate(today).toDateString(),
  );
  const todayMeals = grouped[todayIndex] || [];
  const cooked = (recipe: Recipe) =>
    isRecipeMadeForWeek({
      recipeId: recipe.id,
      currentWeekDate: week,
      madeRecipeIds: plan.data?.made_recipe_ids,
      lastMadeMap: lastMade,
    });
  const dayFor = (recipe: Recipe) =>
    grouped.findIndex((bucket) => bucket.some((item) => item.id === recipe.id));
  const failed =
    config.isError || plan.isError || recipes.isError || history.isError;
  const loading =
    !failed &&
    (config.isLoading ||
      !week ||
      plan.isLoading ||
      recipes.isLoading ||
      history.isLoading);
  const ready = !failed && !loading;
  const range = days.length
    ? `${days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${days[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : '';
  const retry = () => {
    void config.refetch();
    if (week) {
      void plan.refetch();
      void recipes.refetch();
    }
    void history.refetch();
  };

  async function run(recipe: Recipe, action: () => Promise<void>) {
    if (locks.current.has(recipe.id)) return;
    locks.current.add(recipe.id);
    setPending(new Set(locks.current));
    try {
      await action();
    } catch (error) {
      toast.show({
        message: getErrorMessage(
          error,
          `Could not update "${recipe.name}". Try again.`,
        ),
        duration: 4000,
      });
    } finally {
      locks.current.delete(recipe.id);
      setPending(new Set(locks.current));
    }
  }

  function markCooked(recipe: Recipe) {
    const dateMade = toLocalNoonISOString(days[dayFor(recipe)].date);
    void run(recipe, async () => {
      await mark.mutateAsync({
        recipeId: recipe.id,
        weekDate: week,
        isMadeForWeek: false,
        dateMade,
      });
      toast.show({
        message: `"${recipe.name}" marked as cooked`,
        onUndo: () => {
          mark.mutate(
            {
              recipeId: recipe.id,
              weekDate: week,
              isMadeForWeek: true,
              dateMade,
            },
            {
              onError: (error) =>
                toast.show({
                  message: getErrorMessage(error, 'Could not undo cooking.'),
                  duration: 4000,
                }),
            },
          );
        },
      });
    });
  }

  function mealAction(
    action: 'swap' | 'shopping' | 'move' | 'remove',
    recipe: Recipe,
    trigger: HTMLButtonElement | null,
  ) {
    dialogTrigger.current = trigger;
    if (pending.has(recipe.id)) return;
    if ((action === 'swap' || action === 'shopping') && cooked(recipe)) return;
    const day = days[dayFor(recipe)].date.getDay();
    if (action === 'swap')
      setSwap({
        recipe,
        day,
        expectedDay: plan.data?.day_assignments?.[recipe.id] ?? null,
      });
    if (action === 'shopping')
      setShopping({ recipes: [recipe], weekly: false });
    if (action === 'move') {
      setMoveDay(day);
      setMoving(recipe);
    }
    if (action === 'remove')
      void run(recipe, async () => {
        await remove.mutateAsync({ weekDate: week, recipeId: recipe.id });
        toast.show({
          message: `"${recipe.name}" removed from plan`,
          onUndo: () => {
            restore.mutate(
              { weekDate: week, recipeId: recipe.id, dayOfWeek: day },
              {
                onError: (error) =>
                  toast.show({
                    message: getErrorMessage(
                      error,
                      'Could not restore the meal.',
                    ),
                    duration: 4000,
                  }),
              },
            );
          },
        });
      });
  }

  async function submitShopping(selections: ShoppingRecipeSelection[]) {
    const result = await shoppingAdd.mutateAsync({
      recipeIds: selections.map((selection) => selection.recipeId),
      selections,
    });
    toast.show({ message: formatShoppingAddMessage(result), duration: 4000 });
  }

  function menu(recipe: Recipe) {
    return (
      <MealMenu
        recipe={recipe}
        cooked={cooked(recipe)}
        pending={pending.has(recipe.id)}
        onAction={mealAction}
      />
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">YOUR KITCHEN, AT A GLANCE</span>
        <h1 ref={heading} tabIndex={-1}>
          Today
        </h1>
        <p>
          {parseLocalDate(today).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </header>
      <div className="dashboard-grid">
        <section
          className="dashboard-today"
          aria-labelledby="dashboard-today-title"
        >
          <div className="dashboard-section-heading">
            <h2 id="dashboard-today-title" ref={todayHeading} tabIndex={-1}>Today’s meals</h2>
            <Button
              variant="ghost"
              className={`min-h-11 ${ready && !todayMeals.length ? 'hidden' : ''}`}
              disabled={!ready}
              onClick={(event) => openAdd(todayIndex, event.currentTarget)}
            >
              <Plus className="mr-1 h-4 w-4" />
              Plan a meal
            </Button>
          </div>
          {!ready ? (
            <QueryState loading={loading} retry={retry} />
          ) : !todayMeals.length ? (
            <div className="dashboard-empty">
              <p>No meals planned today</p>
              <Button
                className="min-h-11"
                onClick={(event) => openAdd(todayIndex, event.currentTarget)}
              >
                Plan a meal
              </Button>
            </div>
          ) : (
            <div className="dashboard-meal-cards">
              {todayMeals.map((recipe) => {
                const image = getRecipeImageUrl(recipe.image_url);
                return (
                  <article
                    className={`dashboard-meal-card ${image ? '' : 'dashboard-no-photo'}`}
                    key={recipe.id}
                    aria-label={recipe.name}
                  >
                    <div className="dashboard-card-top">
                      <span>
                        {cooked(recipe) ? '✓ COOKED' : 'PLANNED FOR TODAY'}
                      </span>
                      {menu(recipe)}
                    </div>
                    <div className="dashboard-recipe-heading">
                      <Link
                        className={
                          image
                            ? 'dashboard-recipe-image'
                            : 'dashboard-recipe-fallback'
                        }
                        href={buildRecipeDetailHref(recipe.id, 'dashboard')}
                        aria-label={`Open ${recipe.name}`}
                      >
                        <DashboardMealImage src={image} />
                      </Link>
                      <Link
                        className="dashboard-card-title"
                        href={buildRecipeDetailHref(recipe.id, 'dashboard')}
                      >
                        {recipe.name}
                      </Link>
                    </div>
                    <p>
                      {recipe.total_time_minutes
                        ? `${recipe.total_time_minutes} min · `
                        : ''}
                      {recipe.servings} servings
                    </p>
                    <Button
                      className="min-h-11 w-full"
                      variant={cooked(recipe) ? 'secondary' : 'default'}
                      disabled={cooked(recipe) || pending.has(recipe.id)}
                      onClick={() => markCooked(recipe)}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      {cooked(recipe) ? 'Cooked' : 'Mark as cooked'}
                    </Button>
                  </article>
                );
              })}
              {todayMeals.length % 2 === 1 && (
                <Button
                  variant="outline"
                  className="dashboard-plan-card"
                  onClick={(event) => openAdd(todayIndex, event.currentTarget)}
                >
                  <Plus className="h-6 w-6" />
                  <span>
                    Plan a meal<small>Add a recipe to today’s plan</small>
                  </span>
                </Button>
              )}
            </div>
          )}
        </section>
        <ShoppingPreview />
        <section
          className="dashboard-week"
          aria-labelledby="dashboard-week-title"
        >
          <div className="dashboard-section-heading dashboard-week-heading">
            <div>
              <h2 id="dashboard-week-title" tabIndex={-1}>This week</h2>
              <p>{range}</p>
            </div>
            <div className="dashboard-week-actions">
              <Link
                className="dashboard-link"
                href={week ? buildPlannerHref(week, '') : '/planner'}
              >
                Open planner →
              </Link>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!ready || !recipes.data?.length}
                onClick={(event) => {
                  dialogTrigger.current = event.currentTarget;
                  setShopping({ recipes: recipes.data || [], weekly: true });
                }}
              >
                Add week to shopping
              </Button>
            </div>
          </div>
          {!ready ? (
            <QueryState loading={loading} retry={retry} />
          ) : (
            <>
              {!recipes.data?.length && (
                <div className="dashboard-empty">
                  <p>No meals planned this week</p>
                  <Button
                    className="min-h-11"
                    onClick={(event) =>
                      openAdd(todayIndex, event.currentTarget)
                    }
                  >
                    Plan your week
                  </Button>
                </div>
              )}
              <div className="dashboard-week-days">
                {days.map((day, index) => (
                  <div
                    className={`dashboard-day-row ${index === todayIndex ? 'dashboard-is-today' : ''}`}
                    key={index}
                  >
                    <div className="dashboard-day-date">
                      <span>{day.dayName.slice(0, 3)}</span>
                      <strong>{day.dayNumber}</strong>
                      {index === todayIndex && <small>Today</small>}
                      <Button
                        variant="ghost"
                        className="h-11 w-11 shrink-0 p-0"
                        aria-label={`Add meal for ${day.dayName}`}
                        onClick={(event) => openAdd(index, event.currentTarget)}
                      >
                        <Plus className="h-5 w-5" />
                      </Button>
                    </div>
                    <div className="dashboard-day-meals">
                      {grouped[index].map((recipe) => (
                        <div className="dashboard-week-meal" key={recipe.id}>
                          <Link
                            className="dashboard-meal-title"
                            href={buildRecipeDetailHref(recipe.id, 'dashboard')}
                          >
                            {recipe.name}
                            <small>
                              {cooked(recipe)
                                ? '✓ Cooked'
                                : `${recipe.servings} servings`}
                            </small>
                          </Link>
                          {!cooked(recipe) && (
                            <Button
                              variant="ghost"
                              className="h-11 w-11 shrink-0 p-0"
                              aria-label={`Mark ${recipe.name} as cooked`}
                              disabled={pending.has(recipe.id)}
                              onClick={() => markCooked(recipe)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {menu(recipe)}
                        </div>
                      ))}
                      {!grouped[index].length && (
                        <span className="dashboard-unplanned">
                          No meals planned
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      <AddRecipeToPlanModal
        onAdded={() => { addSucceeded.current = true; }}
        onCloseAutoFocus={(event) => {
          // Success can replace an empty slot or disable the old trigger during
          // the plan/recipe refetch. The section heading survives both renders.
          if (addSucceeded.current) {
            event.preventDefault();
            (addFocusFallback.current ?? todayHeading.current)?.focus();
          } else if (dialogTrigger.current?.isConnected && !dialogTrigger.current.disabled) {
            restoreDialogFocus(event);
          } else {
            event.preventDefault();
            (addFocusFallback.current ?? todayHeading.current)?.focus();
          }
        }}
        open={addDay !== null}
        onOpenChange={(open) => {
          if (!open) setAddDay(null);
        }}
        weekDate={week}
        weekStartDay={weekStartDay}
        targetDayIndex={addDay}
      />
      {swap && (
        <SwapMealDialog
          onCloseAutoFocus={restoreDialogFocus}
          open
          recipe={swap.recipe}
          days={days}
          initialDayOfWeek={swap.day}
          plannedRecipeIds={plan.data?.recipe_ids || []}
          onOpenChange={(open) => {
            if (!open) setSwap(null);
          }}
          onSubmit={async (replacementRecipeId, dayOfWeek) => {
            try {
              await replace.mutateAsync({
                weekDate: week,
                oldRecipeId: swap.recipe.id,
                replacementRecipeId,
                dayOfWeek,
                expectedDayOfWeek: swap.expectedDay,
              });
              toast.show({
                message: `"${swap.recipe.name}" swapped`,
                duration: 3000,
              });
            } catch (error) {
              toast.show({
                message: getErrorMessage(error, 'Could not swap the meal.'),
                duration: 4000,
              });
              throw error;
            }
          }}
        />
      )}
      {shopping && (
        <ShoppingSelectionDialog
          onCloseAutoFocus={restoreDialogFocus}
          open
          recipes={shopping.recipes}
          defaultScale={plan.data?.scale ?? 1}
          weekLabel={shopping.weekly ? range : undefined}
          onOpenChange={(open) => {
            if (!open && !shoppingAdd.isPending) setShopping(null);
          }}
          onSubmit={submitShopping}
        />
      )}
      {moving && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending.has(moving.id)) setMoving(null);
          }}
        >
          <DialogContent onCloseAutoFocus={restoreDialogFocus}>
            <DialogHeader className="pr-10">
              <DialogTitle>Move to another day</DialogTitle>
              <DialogDescription>
                Choose a day for {moving.name} in {range}.
              </DialogDescription>
            </DialogHeader>
            <label className="space-y-2 text-sm">
              <span>Scheduled day</span>
              <select
                className="h-11 w-full rounded-lg border bg-card px-3"
                aria-label="Scheduled day"
                value={moveDay}
                disabled={pending.has(moving.id)}
                onChange={(event) => setMoveDay(Number(event.target.value))}
              >
                {days.map((day) => (
                  <option key={day.date.getDay()} value={day.date.getDay()}>
                    {day.dayName},{' '}
                    {day.date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="min-h-11"
              disabled={pending.has(moving.id)}
              onClick={() =>
                void run(moving, async () => {
                  await move.mutateAsync({
                    weekDate: week,
                    dayAssignments: { ...assignments, [moving.id]: moveDay },
                  });
                  setMoving(null);
                })
              }
            >
              Move meal
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
