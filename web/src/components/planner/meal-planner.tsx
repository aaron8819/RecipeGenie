"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  DragStartEvent,
  DragEndEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core"
import { snapCenterToCursor } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle,
  ArrowLeftRight,
  ShoppingCart,
  Loader2,
  Plus,
  CalendarIcon,
  Settings,
  Sparkles,
  Minus,
  X,
  UtensilsCrossed,
} from "lucide-react"
import Image from "next/image"
import "./planner-layout.css"
import { Button } from "@/components/ui/button"
import { AddRecipeToPlanModal } from "./add-recipe-to-plan-modal"
import { PlanSettingsModal } from "./plan-settings-modal"
import { SaveTemplateDialog } from "./save-template-dialog"
import { LoadTemplateDialog } from "./load-template-dialog"
import { ShoppingSelectionDialog } from '@/components/shopping/shopping-selection-dialog'
import type { ShoppingRecipeSelection } from '@/lib/shopping-selection'
import { SwapMealDialog } from './swap-meal-dialog'
import { useReplacePlannedRecipe } from '@/hooks/use-replace-planned-recipe'
import {
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useUserConfig,
  useUpdateUserConfig,
  useGenerateMealPlan,
  useFetchRecipeIds,
  useMarkRecipeMade,
  useRemoveRecipeFromPlan,
  useAddRecipeToPlan,
  useRecentRecipeHistory,
  useRecipeHistoryStats,
  useSaveDayAssignments,
  usePlannerCategories,
} from "@/hooks/use-planner"
import { useAddToShoppingList, useShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useCategories, useToggleFavorite, useRecipes } from "@/hooks/use-recipes"
import { EmptyState } from "@/components/ui/empty-state"
import { BookOpen, Save, FolderOpen } from "lucide-react"
import { getCategoryHexColor } from "@/lib/planner-colors"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import {
  parseLocalDate,
  toLocalNoonISOString,
  dayIndexToDayOfWeek,
  buildUnassignedDayPriority,
} from "@/lib/planner-utils"
import { getRecipeStatsMap, type RecipeStats } from "@/lib/recipe-history-stats"
import { formatShoppingAddMessage } from "@/lib/shopping-feedback"
import { openRecipeDetail } from "@/lib/recipe-detail-navigation"
import { buildPlannerHref } from "@/lib/planner-route-state"
import { cn, getErrorMessage } from "@/lib/utils"
import {
  formatLocalISODate,
  formatWeekLabel,
  getDayOfWeekForWeekIndex,
  getThisAndNextWeekStarts,
  getWeekDays,
  getWeekDayIndexForDate,
  getWeekStartDate,
  navigateWeek,
  resolveEffectiveMobileWeekTab,
  resolveWeekDateForMobileTab,
  type MobileWeekTab,
} from "./meal-planner.utils"
import {
  deriveActiveRecipeOverlay,
  derivePlannerProgress,
  deriveTotalMeals,
  filterTemplateLoadData,
  groupRecipesByPlannerDay,
  isRecipeMadeForWeek,
} from "./meal-planner.selectors"
import {
  PlannerActionBar,
  PlannerDayAddButton,
  PlannerDaySection,
  PlannerDesktopWeekShell,
  PlannerEmptyWeekPanel,
  PlannerMobileTabBar,
  PlannerSectionShell,
} from "./meal-planner-components"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { useSaveWeeklyPlan } from "@/hooks/use-planner"
import type { Recipe, RecipeHistory, PlanTemplate } from "@/types/database"

const SHOPPING_ITEM_LABEL = {
  singular: "shopping item",
  plural: "shopping items",
}

/**
 * Get the most recent "made" date for each recipe from history
 */
function getLastMadeMap(history: RecipeHistory[] | undefined): Map<string, string> {
  const lastMadeMap = new Map<string, string>()
  if (!history) return lastMadeMap

  // History is already sorted by date_made DESC, so first occurrence is most recent
  for (const entry of history) {
    if (!lastMadeMap.has(entry.recipe_id)) {
      lastMadeMap.set(entry.recipe_id, entry.date_made)
    }
  }
  return lastMadeMap
}

/**
 * Check if a date falls within a week's date range.
 * Uses local calendar dates only to avoid UTC vs local mismatches
 * (e.g. "2025-01-26" parsed as UTC can become Jan 25 in US timezones).
 *
 * @param dateStr - Date string (ISO with or without time, or YYYY-MM-DD)
 * @param weekStartDate - Start date of the week (YYYY-MM-DD)
 * @returns true if the calendar date of dateStr falls within the week (inclusive)
 */
/**
 * Compact category pill with inline stepper for meal selection
 */
interface CategoryPillProps {
  category: string
  count: number
  onIncrement: () => void
  onDecrement: () => void
}

function CategoryPill({ category, count, onIncrement, onDecrement }: CategoryPillProps) {
  const isActive = count > 0
  const dotColor = getCategoryHexColor(category)
  const isAccent = category.toLowerCase() === "beef"

  return (
    <div
      className={cn(
        "flex-1 min-w-[120px] bg-stone-50 dark:bg-zinc-800/50 p-3 rounded-xl border flex flex-col items-center transition-all",
        isActive && isAccent && "border-accent/30 ring-1 ring-accent/20",
        isActive && !isAccent && "border-stone-200 dark:border-zinc-700",
        !isActive && "border-stone-200 dark:border-zinc-700"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        <span className="text-xs font-bold uppercase whitespace-nowrap">
          {category}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onDecrement}
          disabled={count === 0}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors disabled:opacity-40",
            isAccent ? "hover:text-accent" : "hover:text-primary"
          )}
          aria-label={`Decrease ${category} count`}
        >
          <Minus className="h-5 w-5" />
        </button>
        <span className="text-xl font-bold tabular-nums">{count}</span>
        <button
          onClick={onIncrement}
          disabled={count === 5}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors disabled:opacity-40",
            isAccent ? "hover:text-accent" : "hover:text-primary"
          )}
          aria-label={`Increase ${category} count`}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

type RecipeDayAssignments = Record<string, number> // recipe_id -> dayIndex (0-6)

/**
 * Wraps a recipe card and runs a flip animation when the recipe in this slot changes (e.g. after swap).
 * Uses stable slot key so only the swapped card flips; other cards are unaffected.
 */
function FlipRecipeCard({
  recipe,
  slotKey,
  children,
}: {
  recipe: Recipe
  slotKey: string
  children: (displayedRecipe: Recipe) => React.ReactNode
}) {
  const [displayedRecipe, setDisplayedRecipe] = useState(recipe)
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle")
  const prevIdRef = useRef(recipe.id)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (recipe.id === prevIdRef.current) {
      setDisplayedRecipe(recipe)
      return
    }
    setPhase("out")
    const t1 = setTimeout(() => {
      setDisplayedRecipe(recipe)
      setPhase("in")
      const t2 = setTimeout(() => {
        setPhase("idle")
        prevIdRef.current = recipe.id
      }, 200)
      timeoutsRef.current.push(t2)
    }, 200)
    timeoutsRef.current.push(t1)
    return () => {
      timeoutsRef.current.forEach(clearTimeout)
      timeoutsRef.current = []
    }
  }, [recipe])

  return (
    <div className="perspective-[1000px]">
      <div
        className={cn(
          "flip-recipe-card-inner",
          phase === "out" && "flip-out",
          phase === "in" && "flip-in"
        )}
      >
        {children(displayedRecipe)}
      </div>
    </div>
  )
}

function DraggableRecipeCard({
  recipe,
  children,
}: {
  recipe: Recipe
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `recipe-${recipe.id}`,
    data: { recipeId: recipe.id },
  })

  const style = {
    touchAction: "none",
    WebkitUserDrag: "none" as const,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-0 pointer-events-none"
      )}
    >
      {children}
    </div>
  )
}

function DayColumn({
  day,
  dayIndex,
  dayRecipes,
  isRecipeMade,
  markingRecipeId,
  addingToCartRecipeId,
  cartAddedRecipeId,
  swappingRecipeId,
  removingRecipeId,
  isInShopping,
  onViewRecipe,
  onSwapRecipe,
  onMarkMade,
  onAddToCart,
  onRemoveRecipe,
  onMoveToDay,
  onAddMeal,
  weekDays,
  currentDayIndex,
  isToday,
  statsMap,
}: {
  day: { date: Date; dayName: string; dayNumber: number }
  dayIndex: number
  dayRecipes: Recipe[]
  isRecipeMade: (recipe: Recipe) => boolean
  markingRecipeId: string | null
  addingToCartRecipeId: string | null
  cartAddedRecipeId: string | null
  swappingRecipeId: string | null
  removingRecipeId: string | null
  isInShopping: (recipeId: string) => boolean
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string, trigger: HTMLButtonElement) => void
  onRemoveRecipe: (recipe: Recipe) => void
  onMoveToDay: (recipeId: string, dayIndex: number) => void
  onAddMeal: (dayIndex?: number) => void
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  isToday?: boolean
  statsMap: Map<string, RecipeStats>
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
  })

  const mainRecipe = dayRecipes[0]
  const extraRecipes = dayRecipes.slice(1)

  return (
    <PlannerDaySection
      ref={setNodeRef}
      className={cn(
        "planner-day-panel transition-colors",
        isOver && "bg-primary/5 ring-2 ring-primary/30"
      )}
      as="section"
      data-day-index={dayIndex}
      data-day-date={formatLocalISODate(day.date)}
      header={<>
        <h2>{day.date.toLocaleDateString("en-US", { weekday: "long" })} <span className="planner-day-date">{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></h2>
        <PlannerDayAddButton desktop onClick={() => onAddMeal(dayIndex)} ariaLabel={"Add meal to " + day.dayName} />
      </>}
      headerClassName="planner-day-header"
    >
      {mainRecipe ? (
        <div>
          <FlipRecipeCard key={`day-${dayIndex}-slot-0`} recipe={mainRecipe} slotKey={`day-${dayIndex}-slot-0`}>
            {(displayedRecipe) => (
              <DraggableRecipeCard recipe={displayedRecipe}>
                <StitchRecipeCard
                  recipe={displayedRecipe}
                  isMade={isRecipeMade(displayedRecipe)}
                  isMarkingThis={markingRecipeId === mainRecipe.id}
                  isAddingToCart={addingToCartRecipeId === mainRecipe.id}
                  isJustAddedToCart={cartAddedRecipeId === mainRecipe.id}
                  isSwapping={swappingRecipeId === mainRecipe.id}
                  isRemoving={removingRecipeId === mainRecipe.id}
                  isInShopping={isInShopping(mainRecipe.id)}
                  isToday={isToday}
                  onView={() => onViewRecipe(mainRecipe)}
                  onSwap={() => onSwapRecipe(mainRecipe)}
                  onMarkMade={() => onMarkMade(mainRecipe.id, isRecipeMade(mainRecipe))}
                  onAddToCart={(trigger) => onAddToCart(mainRecipe.id, trigger)}
                  onRemove={() => onRemoveRecipe(mainRecipe)}
                  onMoveToDay={(dayIdx) => onMoveToDay(mainRecipe.id, dayIdx)}
                  weekDays={weekDays}
                  currentDayIndex={currentDayIndex}
                  showMoveToDay
                  lastMade={statsMap.get(mainRecipe.id)?.lastMade ?? null}
                  timesMade={statsMap.get(mainRecipe.id)?.timesMade ?? 0}
                />
              </DraggableRecipeCard>
            )}
          </FlipRecipeCard>
          {extraRecipes.map((r, slotIdx) => (
            <FlipRecipeCard key={`day-${dayIndex}-slot-${slotIdx + 1}`} recipe={r} slotKey={`day-${dayIndex}-slot-${slotIdx + 1}`}>
              {(displayedRecipe) => (
                <DraggableRecipeCard recipe={displayedRecipe}>
                  <StitchRecipeCard
                    recipe={displayedRecipe}
                    isMade={isRecipeMade(displayedRecipe)}
                    isMarkingThis={markingRecipeId === r.id}
                    isAddingToCart={addingToCartRecipeId === r.id}
                    isJustAddedToCart={cartAddedRecipeId === r.id}
                    isSwapping={swappingRecipeId === r.id}
                    isRemoving={removingRecipeId === r.id}
                    isInShopping={isInShopping(r.id)}
                    isToday={false}
                    onView={() => onViewRecipe(r)}
                    onSwap={() => onSwapRecipe(r)}
                    onMarkMade={() => onMarkMade(r.id, isRecipeMade(r))}
                    onAddToCart={(trigger) => onAddToCart(r.id, trigger)}
                    onRemove={() => onRemoveRecipe(r)}
                    onMoveToDay={(dayIdx) => onMoveToDay(r.id, dayIdx)}
                    weekDays={weekDays}
                    currentDayIndex={currentDayIndex}
                    showMoveToDay
                    lastMade={statsMap.get(r.id)?.lastMade ?? null}
                    timesMade={statsMap.get(r.id)?.timesMade ?? 0}
                  />
                </DraggableRecipeCard>
              )}
            </FlipRecipeCard>
          ))}

        </div>
      ) : (
        <p className="planner-day-empty">No meals planned</p>
      )}
    </PlannerDaySection>
  )
}

/**
 * Day column component (Mobile) — Stitch calendarview_redesign_mobile
 * Day header: "Sunday 25" with border-b; today gets primary styling.
 */
function MobileDayColumn({
  day,
  dayIndex,
  dayRecipes,
  isRecipeMade,
  markingRecipeId,
  addingToCartRecipeId,
  swappingRecipeId,
  cartAddedRecipeId,
  removingRecipeId,
  isInShopping,
  onViewRecipe,
  onSwapRecipe,
  onMarkMade,
  onAddToCart,
  onRemoveRecipe,
  onMoveToDay,
  onAddMeal,
  weekDays,
  currentDayIndex,
  statsMap,
}: {
  day: { date: Date; dayName: string; dayNumber: number }
  dayIndex: number
  dayRecipes: Recipe[]
  isRecipeMade: (recipe: Recipe) => boolean
  markingRecipeId: string | null
  addingToCartRecipeId: string | null
  swappingRecipeId: string | null
  cartAddedRecipeId: string | null
  removingRecipeId: string | null
  isInShopping: (recipeId: string) => boolean
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string, trigger: HTMLButtonElement) => void
  onRemoveRecipe: (recipe: Recipe) => void
  onMoveToDay: (recipeId: string, dayIndex: number) => void
  onAddMeal: (dayIndex?: number) => void
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  statsMap: Map<string, RecipeStats>
}) {
  const today = new Date()
  const isToday = day.date.toDateString() === today.toDateString()
  const dayNameLong = day.date.toLocaleDateString("en-US", { weekday: "long" })

  return (
    <PlannerDaySection
      as="section"
      className="planner-day-panel"
      header={<>
        <h2 className={isToday ? "text-primary dark:text-emerald-400" : undefined}>{dayNameLong} <span className="planner-day-date">{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></h2>
        <PlannerDayAddButton onClick={() => onAddMeal(dayIndex)} ariaLabel={"Add meal to " + dayNameLong} />
      </>}
      headerClassName="planner-day-header"
      data-day-index={dayIndex}
      data-day-date={formatLocalISODate(day.date)}
    >
      {dayRecipes.length > 0 ? (
        <div>
          {dayRecipes.map((recipe, slotIdx) => (
            <FlipRecipeCard
              key={`mobile-day-${dayIndex}-slot-${slotIdx}`}
              recipe={recipe}
              slotKey={`mobile-day-${dayIndex}-slot-${slotIdx}`}
            >
              {(displayedRecipe) => (
                <MobileRecipeCard
                  recipe={displayedRecipe}
                  isMade={isRecipeMade(displayedRecipe)}
                  isMarkingThis={markingRecipeId === recipe.id}
                  isAddingToCart={addingToCartRecipeId === recipe.id}
                  isSwapping={swappingRecipeId === recipe.id}
                  isJustAddedToCart={cartAddedRecipeId === recipe.id}
                  isRemoving={removingRecipeId === recipe.id}
                  isInShopping={isInShopping(recipe.id)}
                  isToday={isToday}
                  onView={() => onViewRecipe(recipe)}
                  onSwap={() => onSwapRecipe(recipe)}
                  onMarkMade={() => onMarkMade(recipe.id, isRecipeMade(recipe))}
                  onAddToCart={(trigger) => onAddToCart(recipe.id, trigger)}
                  onRemove={() => onRemoveRecipe(recipe)}
                  onMoveToDay={(dayIdx) => onMoveToDay(recipe.id, dayIdx)}
                  weekDays={weekDays}
                  currentDayIndex={currentDayIndex}
                  lastMade={statsMap.get(recipe.id)?.lastMade ?? null}
                  timesMade={statsMap.get(recipe.id)?.timesMade ?? 0}
                />
              )}
            </FlipRecipeCard>
          ))}

        </div>
      ) : (
        <p className="planner-day-empty">No meals planned</p>
      )}
    </PlannerDaySection>
  )
}

/**
 * Shared horizontal meal presentation. Action ownership stays in MealPlanner;
 * workflow consolidation belongs to Slice 5.
 */
function StitchRecipeCard({
  recipe,
  isMade,
  isMarkingThis,
  isAddingToCart,
  isJustAddedToCart,
  isSwapping,
  isRemoving,
  isInShopping,
  isToday,
  onView,
  onSwap,
  onMarkMade,
  onAddToCart,
  onRemove,
  onMoveToDay,
  weekDays,
  currentDayIndex,
  showMoveToDay = true,
  lastMade = null,
  timesMade = 0,
}: {
  recipe: Recipe
  isMade: boolean
  isMarkingThis: boolean
  isAddingToCart: boolean
  isJustAddedToCart: boolean
  isSwapping: boolean
  isRemoving: boolean
  isInShopping: boolean
  isToday?: boolean
  onView: () => void
  onSwap: () => void
  onMarkMade: () => void
  onAddToCart: (trigger: HTMLButtonElement) => void
  onRemove: () => void
  onMoveToDay: (dayIndex: number) => void
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  showMoveToDay?: boolean
  lastMade?: string | null
  timesMade?: number
}) {
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  const unoptimizedImage = recipeImageUrl ? !recipeImageUrl.includes(".supabase.co") : false
  return (
    <article className={cn("planner-meal-card", isMade && "planner-meal-cooked", isToday && "planner-meal-today")}>
      <div className="planner-meal-photo">
        {recipeImageUrl ? (
          <Image src={recipeImageUrl} alt="" fill sizes="52px" unoptimized={unoptimizedImage} draggable={false} className="object-cover" />
        ) : <UtensilsCrossed className="h-5 w-5 text-primary/50" aria-hidden />}
      </div>
      <div className="planner-meal-copy">
        <h3><button type="button" onClick={onView} className="planner-meal-title">{recipe.name}</button></h3>
        <p className="planner-meal-meta">
          {recipe.category}{recipe.total_time_minutes ? " · " + recipe.total_time_minutes + " min" : ""} · {recipe.servings} servings
        </p>
        {isInShopping && <p className="planner-meal-meta text-primary">In shopping</p>}
        {(timesMade > 0 || lastMade) && <p className="planner-meal-history">
          Made {timesMade} time{timesMade !== 1 ? "s" : ""}{lastMade && " · Last: " + new Date(lastMade).toLocaleDateString()}
        </p>}
        {isMade && <span className="planner-cooked-badge"><Check className="h-3 w-3" aria-hidden />Cooked</span>}
      </div>
      <div className="planner-meal-actions">
        {!isMade && <>
          <button type="button" onClick={onMarkMade} disabled={isMarkingThis} title="Mark as cooked" aria-label={"Mark " + recipe.name + " as cooked"}>
            {isMarkingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onSwap} disabled={isSwapping} title="Swap recipe" aria-label={"Swap " + recipe.name}>
            {isSwapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
          </button>
          <button type="button" onClick={(event) => onAddToCart(event.currentTarget)} disabled={isAddingToCart} title={isInShopping ? "Add recipe ingredients again to merge any updates in Shopping" : "Add recipe ingredients to Shopping"} aria-label={"Add " + recipe.name + " ingredients to Shopping"}>
            {isAddingToCart ? <Loader2 className="h-4 w-4 animate-spin" /> : isJustAddedToCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          </button>
        </>}
        <button type="button" onClick={onRemove} disabled={isRemoving} title="Remove" aria-label={"Remove " + recipe.name + " from plan"}>
          {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
        {showMoveToDay && <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" title="Move to another day" aria-label="Move to another day"><CalendarIcon className="h-4 w-4" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {weekDays.map((d, idx) => <DropdownMenuItem key={idx} className="min-h-11" onClick={() => onMoveToDay(idx)} disabled={currentDayIndex?.[recipe.id] === d.date.getDay()}>
              <CalendarIcon className="h-4 w-4 mr-2" />{d.dayName}, {d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    </article>
  )
}

function MobileRecipeCard(props: React.ComponentProps<typeof StitchRecipeCard>) {
  return <StitchRecipeCard {...props} />
}

export function MealPlanner({ routeWeek }: { routeWeek?: string | null }) {
  const router = useRouter()
  const [currentWeekDate, setCurrentWeekDate] = useState<string>(() =>
    routeWeek ?? getWeekStartDate(new Date(), 1)
  )
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [markingRecipeId, setMarkingRecipeId] = useState<string | null>(null)
  const [addingToCartRecipeId, setAddingToCartRecipeId] = useState<string | null>(null)
  const [cartAddedRecipeId, setCartAddedRecipeId] = useState<string | null>(null)
  const [bulkCartJustAdded, setBulkCartJustAdded] = useState(false)
  const [shoppingRequest, setShoppingRequest] = useState<{ ids: string[]; weekly: boolean } | null>(null)
  const [swappingRecipeId, setSwappingRecipeId] = useState<string | null>(null)
  const [swapRequest, setSwapRequest] = useState<{ recipe: Recipe; weekDate: string; expectedDayOfWeek: number | null; dayOfWeek: number } | null>(null)
  const [removingRecipeId, setRemovingRecipeId] = useState<string | null>(null)
  const [plannerGenerationError, setPlannerGenerationError] = useState<string | null>(null)
  const [isAddRecipeModalOpen, setIsAddRecipeModalOpen] = useState(false)
  const [addRecipeTargetDayIndex, setAddRecipeTargetDayIndex] = useState<number | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isDatePickerOpenMobile, setIsDatePickerOpenMobile] = useState(false)
  const [isDatePickerOpenDesktop, setIsDatePickerOpenDesktop] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false)
  const [isLoadTemplateOpen, setIsLoadTemplateOpen] = useState(false)
  const [mobileWeekTab, setMobileWeekTab] = useState<MobileWeekTab>(
    "thisWeek"
  )
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const plannerFocusFallback = useRef<HTMLDivElement>(null)
  function rememberDialogTrigger(trigger?: HTMLElement) {
    dialogTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement : null)
  }
  function restoreDialogFocus(event: Event) {
    event.preventDefault()
    const trigger = dialogTrigger.current
    if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus()
    else plannerFocusFallback.current?.focus()
  }
  const mobileDaysContainerRef = useRef<HTMLDivElement>(null)
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null)
  const [pendingAssignmentOverlays, setPendingAssignmentOverlays] = useState<Record<string, Record<string, number>>>({})
  const [pendingAssignmentCounts, setPendingAssignmentCounts] = useState<Record<string, number>>({})
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return window.matchMedia("(min-width: 1024px)").matches
  })

  const handleOpenRecipe = useCallback((recipe: Recipe) => {
    openRecipeDetail(router, recipe.id, "planner")
  }, [router])

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(min-width: 1024px)")
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Hook to save day assignments to database
  const saveDayAssignments = useSaveDayAssignments()
  const fetchRecipeIds = useFetchRecipeIds()

  const { data: config } = useUserConfig()
  const updateConfig = useUpdateUserConfig()
  const {
    data: weeklyPlan,
    isLoading: planLoading,
    isPending: planPending,
    isError: planReadFailed,
    isFetching: planFetching,
    refetch: retryPlanRead,
  } = useWeeklyPlan(currentWeekDate)
  const { selections: shoppingSelections } = useShoppingList()

  const clearPendingAssignmentOverlay = useCallback((weekDate: string) => {
    setPendingAssignmentCounts((prev) => {
      const currentCount = prev[weekDate] || 0
      if (currentCount <= 1) {
        const next = { ...prev }
        delete next[weekDate]
        setPendingAssignmentOverlays((overlayPrev) => {
          const overlayNext = { ...overlayPrev }
          delete overlayNext[weekDate]
          return overlayNext
        })
        return next
      }

      return {
        ...prev,
        [weekDate]: currentCount - 1,
      }
    })
  }, [])

  // Visible assignments are query-backed base state plus a pending overlay for the selected week.
  const recipeDayAssignments = useMemo(() => {
    const baseAssignments = weeklyPlan?.day_assignments || {}
    const overlayAssignments = pendingAssignmentOverlays[currentWeekDate] || {}
    return {
      ...baseAssignments,
      ...overlayAssignments,
    }
  }, [weeklyPlan?.day_assignments, pendingAssignmentOverlays, currentWeekDate])

  useEffect(() => {
    setPendingAssignmentOverlays({})
    setPendingAssignmentCounts({})
    setPlannerGenerationError(null)
    setSwapRequest(null)
  }, [currentWeekDate])

  const currentWeekStart = useMemo(
    () => getWeekStartDate(new Date(), config?.week_start_day ?? 1),
    [config?.week_start_day]
  )
  const isCurrentWeek = currentWeekDate === currentWeekStart
  const isTodayMode = mobileWeekTab === "today" && isCurrentWeek

  // Get week days for calendar view (needed early for handleMarkMade)
  const weekDays = useMemo(() => {
    return getWeekDays(currentWeekDate)
  }, [currentWeekDate])

  // Mobile: "Today" only applies when viewing the current week.
  const mobileDays = useMemo(() => {
    if (mobileWeekTab === "today" && isCurrentWeek) {
      const t = new Date().toDateString()
      return weekDays.filter((d) => d.date.toDateString() === t)
    }
    return weekDays
  }, [weekDays, mobileWeekTab, isCurrentWeek])

  // Compute effective tab based on currentWeekDate to keep visual indicator in sync
  // This prevents tab/date desync when using chevron navigation beyond this/next week
  const effectiveTab = useMemo((): MobileWeekTab | null => {
    return resolveEffectiveMobileWeekTab(mobileWeekTab, currentWeekDate, config?.week_start_day ?? 1)
  }, [currentWeekDate, mobileWeekTab, config?.week_start_day])

  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])
  const { data: history } = useRecentRecipeHistory()
  const { data: historyStats } = useRecipeHistoryStats()
  const { data: allCategories } = useCategories()
  const plannerCategories = usePlannerCategories()
  const { data: allRecipes } = useRecipes({ limit: 1 })
  const hasAnyRecipes = (allRecipes?.length ?? 0) > 0

  const generatePlan = useGenerateMealPlan()
  const replacePlannedRecipe = useReplacePlannedRecipe()
  const markMade = useMarkRecipeMade()
  const removeFromPlan = useRemoveRecipeFromPlan()
  const addRecipeToPlan = useAddRecipeToPlan()
  const addToShoppingList = useAddToShoppingList()
  const toggleFavorite = useToggleFavorite()
  const saveWeeklyPlan = useSaveWeeklyPlan()
  const undoToast = useUndoToast()

  // Build a map of recipe_id -> last made date
  const lastMadeMap = getLastMadeMap(history)
  
  // Build a map of recipe_id -> stats (last made + times made)
  const statsMap = useMemo(() => getRecipeStatsMap(historyStats), [historyStats])

  useEffect(() => {
    const defaultWeek = getWeekStartDate(
      new Date(),
      config?.week_start_day ?? 1
    )
    setCurrentWeekDate(routeWeek ?? defaultWeek)
  }, [config?.week_start_day, routeWeek])

  const navigateToWeek = useCallback((weekDate: string) => {
    const defaultWeek = getWeekStartDate(
      new Date(),
      config?.week_start_day ?? 1
    )
    setCurrentWeekDate(weekDate)
    router.push(buildPlannerHref(weekDate, defaultWeek))
  }, [config?.week_start_day, router])

  // Initialize selection from config
  useEffect(() => {
    if (config?.default_selection) {
      setSelection(config.default_selection as Record<string, number>)
    }
  }, [config?.default_selection])

  const handlePrevWeek = () => {
    const next = navigateWeek(currentWeekDate, "prev")
    navigateToWeek(next)
    const { thisWeekStart, nextWeekStart } = getThisAndNextWeekStarts(new Date(), config?.week_start_day ?? 1)
    if (next === thisWeekStart) setMobileWeekTab("thisWeek")
    else if (next === nextWeekStart) setMobileWeekTab("nextWeek")
  }

  const handleNextWeek = () => {
    const next = navigateWeek(currentWeekDate, "next")
    navigateToWeek(next)
    const { thisWeekStart, nextWeekStart } = getThisAndNextWeekStarts(new Date(), config?.week_start_day ?? 1)
    if (next === thisWeekStart) setMobileWeekTab("thisWeek")
    else if (next === nextWeekStart) setMobileWeekTab("nextWeek")
  }

  const handleMobileWeekTab = (tab: MobileWeekTab) => {
    setMobileWeekTab(tab)
    navigateToWeek(
      resolveWeekDateForMobileTab(tab, config?.week_start_day ?? 1)
    )
  }

  const handleGeneratePlan = () => {
    if (!currentWeekDate) return
    setPlannerGenerationError(null)
    // Show confirmation if there are existing recipes
    if (weeklyPlan?.recipe_ids && weeklyPlan.recipe_ids.length > 0) {
      setShowRegenerateConfirm(true)
    } else {
      void executeGeneratePlan()
    }
  }

  const executeGeneratePlan = async () => {
    if (!currentWeekDate) return
    setPlannerGenerationError(null)
    try {
      await generatePlan.mutateAsync({ weekDate: currentWeekDate, selection })
      setShowRegenerateConfirm(false)
    } catch (error) {
      setPlannerGenerationError(getErrorMessage(error, "Failed to generate this meal plan"))
    }
  }

  const handleGenerateShoppingList = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!weeklyPlan?.recipe_ids || weeklyPlan.recipe_ids.length === 0) return
    if (!recipes || weeklyPlan.recipe_ids.some(id => !recipes.some(recipe => recipe.id === id))) {
      undoToast.show({ message: 'Recipes are still loading. Try again.', duration: 4000 })
      return
    }
    rememberDialogTrigger(event.currentTarget)
    setShoppingRequest({ ids: weeklyPlan.recipe_ids, weekly: true })
  }

  const handleLoadTemplate = async (template: PlanTemplate) => {
    if (!currentWeekDate) return
    try {
      const recipeIds = await fetchRecipeIds.mutateAsync()
      const filteredTemplate = filterTemplateLoadData({
        template,
        existingRecipeIds: new Set(recipeIds),
      })

      await saveWeeklyPlan.mutateAsync({
        weekDate: currentWeekDate,
        recipeIds: filteredTemplate.recipeIds,
        dayAssignments: filteredTemplate.dayAssignments,
      })

      if (filteredTemplate.categorySelection) {
        setSelection(filteredTemplate.categorySelection)
      }

      let msg = `Template "${template.name}" loaded`
      if (filteredTemplate.missingCount > 0) {
        msg += ` (${filteredTemplate.missingCount} deleted recipe${filteredTemplate.missingCount !== 1 ? 's' : ''} removed)`
      }
      undoToast.show({ message: msg, duration: 4000 })
    } catch (error) {
      throw new Error(getErrorMessage(error, `Failed to load template "${template.name}"`))
    }
  }

  const handleSwapRecipe = (recipe: Recipe) => {
    if (!currentWeekDate) return
    rememberDialogTrigger()
    setSwapRequest({
      recipe,
      weekDate: currentWeekDate,
      expectedDayOfWeek: weeklyPlan?.day_assignments?.[recipe.id] ?? null,
      dayOfWeek: recipeDayAssignments[recipe.id] ?? weekDays[0].date.getDay(),
    })
  }

  const handleExplicitSwap = async (replacementRecipeId: string, dayOfWeek: number) => {
    if (!swapRequest) return
    setSwappingRecipeId(swapRequest.recipe.id)
    try {
      await replacePlannedRecipe.mutateAsync({
        weekDate: swapRequest.weekDate,
        oldRecipeId: swapRequest.recipe.id,
        replacementRecipeId,
        dayOfWeek,
        expectedDayOfWeek: swapRequest.expectedDayOfWeek,
      })
    } finally {
      setSwappingRecipeId(null)
    }
  }

  const handleMarkMade = useCallback(async (recipeId: string, isMadeForWeek: boolean) => {
    if (!currentWeekDate) return

    // Get recipe name for the toast message
    const recipe = recipes?.find(r => r.id === recipeId)
    const recipeName = recipe?.name || "Recipe"

    // Calculate the date to use: if recipe is assigned to a day, use that day's date
    // Otherwise, use today's date (for recipes marked from recipe view or unassigned recipes)
    let dateMade: string | undefined
    const assignedDayOfWeek = recipeDayAssignments[recipeId]
    if (assignedDayOfWeek !== undefined) {
      const assignedDay = weekDays.find((d) => d.date.getDay() === assignedDayOfWeek)
      if (assignedDay) {
        // Recipe is assigned to a specific day - use that day's date (local noon)
        dateMade = toLocalNoonISOString(assignedDay.date)
      }
    }
    // If no day assignment, dateMade will be undefined and the hook will use today's date

    setMarkingRecipeId(recipeId)
    try {
      // Execute the mutation immediately
      await markMade.mutateAsync({ recipeId, weekDate: currentWeekDate, isMadeForWeek, dateMade })

      // Show undo toast after mutation succeeds
      undoToast.show({
        message: isMadeForWeek
          ? `"${recipeName}" unmarked as made`
          : `"${recipeName}" marked as made`,
        onUndo: () => {
          // Toggle back the made status
          markMade.mutate({
            recipeId,
            weekDate: currentWeekDate,
            isMadeForWeek: !isMadeForWeek, // Toggle back
            dateMade, // Preserve the same date on undo
          })
        },
        onExpire: () => {
          // Mutation already executed, nothing to do
        },
      })
    } catch (error) {
      undoToast.show({
        message: getErrorMessage(error, `Failed to update "${recipeName}"`),
        duration: 4000,
      })
    } finally {
      setMarkingRecipeId(null)
    }
  }, [currentWeekDate, recipes, markMade, undoToast, recipeDayAssignments, weekDays])

  const handleRemoveFromPlan = useCallback((recipe: Recipe) => {
    if (!currentWeekDate) return
    if (removingRecipeId === recipe.id) return
    // Capture day assignment before removing so undo can restore it
    const savedDayOfWeek = recipeDayAssignments[recipe.id]
    setRemovingRecipeId(recipe.id)
    removeFromPlan.mutate(
      { weekDate: currentWeekDate, recipeId: recipe.id },
      {
        onSuccess: () => {
          undoToast.show({
            message: `"${recipe.name}" removed from plan`,
            onUndo: () => {
              addRecipeToPlan.mutate(
                {
                  weekDate: currentWeekDate,
                  recipeId: recipe.id,
                  dayOfWeek: savedDayOfWeek,
                },
                {
                  onError: (error) => {
                    undoToast.show({
                      message: getErrorMessage(error, `Failed to restore "${recipe.name}" to the plan`),
                      duration: 4000,
                    })
                  },
                }
              )
            },
          })
        },
        onError: (error) => {
          undoToast.show({
            message: getErrorMessage(error, `Failed to remove "${recipe.name}" from the plan`),
            duration: 4000,
          })
        },
        onSettled: () => {
          setRemovingRecipeId((current) => (current === recipe.id ? null : current))
        },
      },
    )
  }, [addRecipeToPlan, currentWeekDate, recipeDayAssignments, removeFromPlan, removingRecipeId, undoToast])

  const handleAddRecipeToCart = (recipeId: string, trigger: HTMLButtonElement) => {
    rememberDialogTrigger(trigger)
    setShoppingRequest({ ids: [recipeId], weekly: false })
  }

  const handleShoppingSelectionSubmit = async (selections: ShoppingRecipeSelection[]) => {
    const weekly = shoppingRequest?.weekly ?? false
    const recipeId = weekly ? null : selections[0]?.recipeId
    setAddingToCartRecipeId(recipeId ?? null)
    try {
      const result = await addToShoppingList.mutateAsync({ recipeIds: selections.map(selection => selection.recipeId), selections })
      const recipeName = displayedRecipes?.find((recipe) => recipe.id === recipeId)?.name
      undoToast.show({
        message: formatShoppingAddMessage(result, {
          sourceName: recipeName,
          itemLabel: SHOPPING_ITEM_LABEL,
          zeroMessage: recipeName
            ? `All shopping items from "${recipeName}" are already on the shopping list`
            : "Everything from this recipe is already on the shopping list",
        }),
        duration: 4000,
      })
      if (result.added > 0) {
        if (weekly) {
          setBulkCartJustAdded(true)
          setTimeout(() => setBulkCartJustAdded(false), 1500)
        } else if (recipeId) {
          setCartAddedRecipeId(recipeId)
          setTimeout(() => setCartAddedRecipeId(null), 1500)
        }
      }
    } catch (error) {
      console.error("Failed to add recipe to shopping list:", error)
      undoToast.show({
        message: getErrorMessage(error, "Failed to add recipe to shopping list"),
        duration: 4000,
      })
      throw error
    } finally {
      setAddingToCartRecipeId(null)
    }
  }

  // Move recipe to a different day
  const handleMoveToDay = useCallback((recipeId: string, dayIndex: number) => {
    if (!currentWeekDate || dayIndex < 0 || dayIndex >= 7) return

    const weekStartDay = config?.week_start_day ?? 1
    const dayOfWeek = dayIndexToDayOfWeek(dayIndex, weekStartDay)

    // Update local state immediately for optimistic UI update
    const updatedAssignments = {
      ...recipeDayAssignments,
      [recipeId]: dayOfWeek,
    }
    setPendingAssignmentOverlays((prev) => ({
      ...prev,
      [currentWeekDate]: updatedAssignments,
    }))
    setPendingAssignmentCounts((prev) => ({
      ...prev,
      [currentWeekDate]: (prev[currentWeekDate] || 0) + 1,
    }))

    saveDayAssignments.mutate(
      {
        weekDate: currentWeekDate,
        dayAssignments: updatedAssignments,
      },
      {
        onSettled: () => {
          clearPendingAssignmentOverlay(currentWeekDate)
        },
      }
    )
  }, [currentWeekDate, recipeDayAssignments, saveDayAssignments, config?.week_start_day, clearPendingAssignmentOverlay])

  const categories = allCategories || config?.categories || []
  const totalMeals = deriveTotalMeals(selection)

  const displayedRecipes = recipes
  const shoppingRecipeIds = useMemo(
    () => new Set(shoppingSelections.map((selection) => selection.recipeId)),
    [shoppingSelections]
  )
  const activeRecipeOverlay = useMemo(() => deriveActiveRecipeOverlay({
    recipes: displayedRecipes,
    activeRecipeId,
  }), [displayedRecipes, activeRecipeId])
  const activeRecipe = activeRecipeOverlay?.recipe ?? null

  // Build day priority for distributing unassigned recipes (preferred first, then available)
  const unassignedDayPriority = useMemo(
    () => buildUnassignedDayPriority(config?.excluded_days || [], config?.preferred_days || null),
    [config?.excluded_days, config?.preferred_days]
  )

  const recipesByDay = useMemo(() => groupRecipesByPlannerDay({
    recipes: displayedRecipes,
    recipeDayAssignments,
    weekDayNumbers: weekDays.map((day) => day.date.getDay()),
    unassignedDayPriority,
  }), [displayedRecipes, recipeDayAssignments, weekDays, unassignedDayPriority])

  const getRecipesByDay = useCallback((dayIndex: number): Recipe[] => {
    return recipesByDay[dayIndex] || []
  }, [recipesByDay])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const recipeId = event.active.data.current?.recipeId
    if (recipeId) setActiveRecipeId(recipeId)
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveRecipeId(null)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const recipeId = event.active.data.current?.recipeId
    const overId = event.over?.id ? String(event.over.id) : null
    setActiveRecipeId(null)

    if (!recipeId || !overId) return
    const match = overId.match(/day-(\d+)$/)
    if (!match) return
    const targetDayIndex = Number(match[1])
    if (Number.isNaN(targetDayIndex)) return
    if (!weekDays[targetDayIndex]) return

    const targetDayOfWeek = getDayOfWeekForWeekIndex(weekDays, targetDayIndex)
    if (recipeDayAssignments[recipeId] === targetDayOfWeek) return

    handleMoveToDay(recipeId, targetDayIndex)
  }, [handleMoveToDay, recipeDayAssignments, weekDays])

  const progress = useMemo(() => derivePlannerProgress({
    recipes: displayedRecipes,
    currentWeekDate,
    madeRecipeIds: weeklyPlan?.made_recipe_ids,
    lastMadeMap,
  }), [displayedRecipes, weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  const isRecipeMade = useCallback((recipe: Recipe): boolean => {
    return isRecipeMadeForWeek({
      recipeId: recipe.id,
      currentWeekDate,
      madeRecipeIds: weeklyPlan?.made_recipe_ids,
      lastMadeMap,
    })
  }, [weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  const isRecipeInShopping = useCallback((recipeId: string) => {
    return shoppingRecipeIds.has(recipeId)
  }, [shoppingRecipeIds])

  const plannedRecipeCount = displayedRecipes?.length || 0
  const plannedRecipesInShoppingCount = useMemo(
    () => (displayedRecipes || []).filter((recipe) => shoppingRecipeIds.has(recipe.id)).length,
    [displayedRecipes, shoppingRecipeIds]
  )
  const plannedRecipesRemainingForShopping = Math.max(
    0,
    plannedRecipeCount - plannedRecipesInShoppingCount
  )

  const plannerShoppingSummary = useMemo(() => {
    if (plannedRecipeCount === 0) return null
    if (plannedRecipesInShoppingCount === 0) {
      return null
    }
    if (plannedRecipesRemainingForShopping === 0) {
      return "All planned recipes are already in Shopping. Re-adding merges any ingredient changes."
    }
    return `${plannedRecipesInShoppingCount} of ${plannedRecipeCount} planned recipes are already in Shopping. Add to Shopping sends the rest and merges duplicates.`
  }, [
    plannedRecipeCount,
    plannedRecipesInShoppingCount,
    plannedRecipesRemainingForShopping,
  ])

  // A failed refetch can leave cached data. Hide it and all plan actions until
  // recovery rather than treating unavailable state as an empty or current week.
  if (planReadFailed || planPending || planLoading) {
    return (
      <div className="planner-layout space-y-4 pb-6" ref={plannerFocusFallback} tabIndex={-1} aria-label="Meal planner">
        <h1 className="font-display text-3xl font-bold text-primary">Planner</h1>
        {planReadFailed ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3">
            <p role="alert" className="text-sm text-destructive">
              Couldn't load this week's plan. Meals and plan actions are unavailable until it loads successfully.
            </p>
            <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={planFetching} onClick={() => void retryPlanRead()}>
              {planFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-muted-foreground text-center py-8">Loading this week's plan...</p>
        )}
      </div>
    )
  }

  const plannerContent = (
    <div className="planner-layout space-y-4 pb-6" ref={plannerFocusFallback} tabIndex={-1} aria-label="Meal planner">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-primary">Planner</h1>
        {!isDesktop && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="default"
                  className="h-11 shrink-0 rounded-xl border-stone-200 bg-white/70 text-slate-700 hover:bg-stone-100/80"
                  aria-label="More planner actions"
                >
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setIsSaveTemplateOpen(true)}
                  disabled={!displayedRecipes?.length}
                  className="min-h-11"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsLoadTemplateOpen(true)} className="min-h-11">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Load template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        )}
      </div>
      <div className="planner-week-toolbar">
        <Button variant="outline" className="h-11 w-11 p-0" onClick={handlePrevWeek} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
        <Popover open={isDesktop ? isDatePickerOpenDesktop : isDatePickerOpenMobile} onOpenChange={isDesktop ? setIsDatePickerOpenDesktop : setIsDatePickerOpenMobile}>
          <PopoverTrigger asChild><button type="button" className="planner-week-date" aria-label="Open calendar to pick a week">{formatWeekLabel(currentWeekDate)}</button></PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center">
            <Calendar selected={currentWeekDate ? parseLocalDate(currentWeekDate) : undefined} onSelect={(date) => {
              if (date) {
                const weekStart = getWeekStartDate(date, config?.week_start_day ?? 1)
                navigateToWeek(weekStart)
                setIsDatePickerOpenDesktop(false)
                setIsDatePickerOpenMobile(false)
                const { thisWeekStart, nextWeekStart } = getThisAndNextWeekStarts(new Date(), config?.week_start_day ?? 1)
                if (weekStart === thisWeekStart) setMobileWeekTab("thisWeek")
                else if (weekStart === nextWeekStart) setMobileWeekTab("nextWeek")
              }
            }} />
          </PopoverContent>
        </Popover>
        <Button variant="outline" className="h-11 w-11 p-0" onClick={handleNextWeek} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" className="planner-current-week h-11" onClick={() => handleMobileWeekTab("thisWeek")}>This week</Button>
        <Button variant="ghost" className="h-11 w-11 p-0" onClick={() => setIsSettingsModalOpen(true)} aria-label="Open planner settings"><Settings className="h-4 w-4" /></Button>
      </div>
      <div className="planner-progress" aria-label="Weekly progress">
        <span>{progress.made} of {progress.total} meals cooked</span>
        <div className="planner-progress-track"><div style={{ width: progress.percentage + "%" }} /></div>
      </div>
      {plannerGenerationError ? (
        <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive" role="alert">
              {plannerGenerationError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void executeGeneratePlan()}
              disabled={generatePlan.isPending}
              className="shrink-0"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {/* Week navigation (mobile) + Add to Cart */}
      <PlannerActionBar
        leading={!isDesktop ? (
          <PlannerMobileTabBar
            tabs={[
              { key: "today", label: "Today", isActive: effectiveTab === "today", onClick: () => handleMobileWeekTab("today") },
              { key: "thisWeek", label: "This Week", isActive: effectiveTab === "thisWeek", onClick: () => handleMobileWeekTab("thisWeek") },
              { key: "nextWeek", label: "Next Week", isActive: effectiveTab === "nextWeek", onClick: () => handleMobileWeekTab("nextWeek") },
            ]}
          />
        ) : undefined}
      >
          <Button
            onClick={() => { rememberDialogTrigger(); setAddRecipeTargetDayIndex(null); setIsAddRecipeModalOpen(true); }}
            disabled={!hasAnyRecipes}
            variant="default"
            size="default"
            className="h-11 shrink-0 rounded-xl px-5 shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add meal
          </Button>
          <Button
            onClick={handleGenerateShoppingList}
            disabled={addToShoppingList.isPending || !displayedRecipes?.length}
            variant="outline"
            size="default"
            title="Add ingredients from planned meals to Shopping. Existing items are merged instead of duplicated."
            aria-label="Add planned meal ingredients to Shopping"
            className={cn(
              "h-11 shrink-0 rounded-xl border transition-colors",
              bulkCartJustAdded
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-primary/25 bg-primary/5 text-primary hover:border-primary/40 hover:bg-primary/10"
            )}
          >
            {addToShoppingList.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : bulkCartJustAdded ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <ShoppingCart className="h-4 w-4 mr-2" />
            )}
            {bulkCartJustAdded ? "Plan Added" : "Add full week to Shopping"}
          </Button>
          {isDesktop ? (
            <>
              <Button
                onClick={() => setIsSaveTemplateOpen(true)}
                disabled={!displayedRecipes?.length}
                variant="outline"
                size="default"
                title="Save current plan as template"
                className="h-11 shrink-0 rounded-xl border-stone-200 bg-white/70 px-3.5 text-slate-700 hover:bg-stone-100/80"
              >
                <Save className="mr-1.5 h-4 w-4" />
                Save Template
              </Button>
              <Button
                onClick={() => setIsLoadTemplateOpen(true)}
                variant="outline"
                size="default"
                title="Load a saved template"
                className="h-11 shrink-0 rounded-xl border-stone-200 bg-white/70 px-3.5 text-slate-700 hover:bg-stone-100/80"
              >
                <FolderOpen className="mr-1.5 h-4 w-4" />
                Load Template
              </Button>
            </>
          ) : null}
      </PlannerActionBar>

      {plannerShoppingSummary ? (
        <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-4 py-3 text-sm text-slate-600">
          <p>{plannerShoppingSummary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Shopping rows keep recipe source labels, so you can trace each item back to this plan.
          </p>
        </div>
      ) : null}

      {planLoading ? (
        <p className="text-muted-foreground text-center py-8">Loading this week's plan...</p>
        ) : !displayedRecipes || displayedRecipes.length === 0 ? (
          !hasAnyRecipes ? (
            <EmptyState
              icon={BookOpen}
              title="Add recipes first"
              description="You need recipes before you can plan meals. Add a few in Recipes, then come back to build this week."
              action={{
                label: "Go to Recipes",
                onClick: () => router.push("/recipes"),
              }}
            />
          ) : (
            <>
              {/* Mobile: category selection + Generate Plan when week has no meals */}
              {!isDesktop && (
              <PlannerEmptyWeekPanel>
                <div className="w-full max-w-md flex flex-wrap gap-3 justify-center mb-6">
                  {plannerCategories.map((category: string) => (
                    <CategoryPill
                      key={category}
                      category={category}
                      count={selection[category] || 0}
                      onIncrement={() => {
                        setSelection((prev) => ({
                          ...prev,
                          [category]: Math.min(5, (prev[category] || 0) + 1),
                        }))
                      }}
                      onDecrement={() => {
                        setSelection((prev) => ({
                          ...prev,
                          [category]: Math.max(0, (prev[category] || 0) - 1),
                        }))
                      }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Button
                    onClick={() => { rememberDialogTrigger(); setAddRecipeTargetDayIndex(null); setIsAddRecipeModalOpen(true); }}
                    disabled={!hasAnyRecipes}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add recipe
                  </Button>
                  <Button
                    onClick={handleGeneratePlan}
                    disabled={generatePlan.isPending || totalMeals === 0}
                    className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                  >
                    {generatePlan.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    <span className="ml-2">Generate Plan</span>
                  </Button>
                </div>
              </PlannerEmptyWeekPanel>
              )}
              {/* Desktop: calendar week with Add meal on each day */}
            {isDesktop && (
            <PlannerDesktopWeekShell>
                  {weekDays.map((day, dayIndex) => {
                    const today = new Date()
                    const isToday = day.date.toDateString() === today.toDateString()
                    return (
                      <DayColumn
                        key={day.date.toISOString()}
                        day={day}
                        dayIndex={dayIndex}
                        dayRecipes={[]}
                        isRecipeMade={isRecipeMade}
                        markingRecipeId={markingRecipeId}
                        addingToCartRecipeId={addingToCartRecipeId}
                        cartAddedRecipeId={cartAddedRecipeId}
                        swappingRecipeId={swappingRecipeId}
                        removingRecipeId={removingRecipeId}
                        isInShopping={isRecipeInShopping}
                        onViewRecipe={handleOpenRecipe}
                        onSwapRecipe={handleSwapRecipe}
                        onMarkMade={handleMarkMade}
                        onAddToCart={handleAddRecipeToCart}
                        onRemoveRecipe={handleRemoveFromPlan}
                        onMoveToDay={handleMoveToDay}
                        onAddMeal={(d) => { rememberDialogTrigger(); setAddRecipeTargetDayIndex(d ?? null); setIsAddRecipeModalOpen(true); }}
                        weekDays={weekDays}
                        currentDayIndex={recipeDayAssignments}
                        isToday={isToday}
                        statsMap={statsMap}
                      />
                      )
                  })}
            </PlannerDesktopWeekShell>
              )}
            </>
          )
        ) : (
          <>
            {/* Desktop: Calendar View (7-day grid) with week navigation */}
            {isDesktop && (
            <PlannerDesktopWeekShell>
                {weekDays.map((day, dayIndex) => {
                  const dayRecipes = getRecipesByDay(dayIndex)
                  const today = new Date()
                  const isToday = day.date.toDateString() === today.toDateString()
                  return (
                    <DayColumn
                      key={day.date.toISOString()}
                      day={day}
                      dayIndex={dayIndex}
                      dayRecipes={dayRecipes}
                      isRecipeMade={isRecipeMade}
                      markingRecipeId={markingRecipeId}
                      addingToCartRecipeId={addingToCartRecipeId}
                      cartAddedRecipeId={cartAddedRecipeId}
                      swappingRecipeId={swappingRecipeId}
                      removingRecipeId={removingRecipeId}
                      isInShopping={isRecipeInShopping}
                      onViewRecipe={handleOpenRecipe}
                      onSwapRecipe={handleSwapRecipe}
                      onMarkMade={handleMarkMade}
                      onAddToCart={handleAddRecipeToCart}
                      onRemoveRecipe={handleRemoveFromPlan}
                      onMoveToDay={handleMoveToDay}
                      onAddMeal={(dayIndex) => { rememberDialogTrigger(); setAddRecipeTargetDayIndex(dayIndex ?? null); setIsAddRecipeModalOpen(true); }}
                      weekDays={weekDays}
                      currentDayIndex={recipeDayAssignments}
                      isToday={isToday}
                      statsMap={statsMap}
                    />
                  )
                })}
            </PlannerDesktopWeekShell>
            )}

            {/* Mobile: calendar view — Stitch calendarview_redesign_mobile: week strip + day sections */}
            {!isDesktop && (
            <div className="space-y-6">
              <div className="planner-agenda" ref={mobileDaysContainerRef}>
                {mobileDays.map((day) => {
                  const dayIndex = getWeekDayIndexForDate(weekDays, day.date)
                  const dayRecipes = getRecipesByDay(dayIndex >= 0 ? dayIndex : 0)
                  return (
                    <MobileDayColumn
                      key={day.date.toISOString()}
                      day={day}
                      dayIndex={dayIndex >= 0 ? dayIndex : 0}
                      dayRecipes={dayRecipes}
                      isRecipeMade={isRecipeMade}
                      markingRecipeId={markingRecipeId}
                      addingToCartRecipeId={addingToCartRecipeId}
                      swappingRecipeId={swappingRecipeId}
                      cartAddedRecipeId={cartAddedRecipeId}
                      removingRecipeId={removingRecipeId}
                      isInShopping={isRecipeInShopping}
                      onViewRecipe={handleOpenRecipe}
                      onSwapRecipe={handleSwapRecipe}
                      onMarkMade={handleMarkMade}
                      onAddToCart={handleAddRecipeToCart}
                      onRemoveRecipe={handleRemoveFromPlan}
                      onMoveToDay={handleMoveToDay}
                      onAddMeal={(dayIndex) => { rememberDialogTrigger(); setAddRecipeTargetDayIndex(dayIndex ?? null); setIsAddRecipeModalOpen(true); }}
                      weekDays={weekDays}
                      currentDayIndex={recipeDayAssignments}
                      statsMap={statsMap}
                    />
                  )
                })}
              </div>
            </div>
            )}

          </>
        )}
      {isDesktop && (
        <PlannerSectionShell
          className="planner-generation"
          headerClassName="flex items-center justify-between mb-4"
          header={
            <>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Quick Meal Mix
              </h3>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="text-primary text-sm font-medium hover:underline"
              >
                Settings
              </button>
            </>
          }
        >
          <div className="flex flex-wrap gap-4">
            {plannerCategories.map((category: string) => (
              <CategoryPill
                key={category}
                category={category}
                count={selection[category] || 0}
                onIncrement={() => {
                  setSelection((prev) => ({
                    ...prev,
                    [category]: Math.min(5, (prev[category] || 0) + 1),
                  }))
                }}
                onDecrement={() => {
                  setSelection((prev) => ({
                    ...prev,
                    [category]: Math.max(0, (prev[category] || 0) - 1),
                  }))
                }}
              />
            ))}
            <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
              <Button
                onClick={handleGeneratePlan}
                disabled={generatePlan.isPending || totalMeals === 0}
                className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
              >
                {generatePlan.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="ml-2">Generate Plan</span>
              </Button>
            </div>
          </div>
        </PlannerSectionShell>
      )}
      {/* Add Recipe to Plan Modal */}
      {swapRequest && <SwapMealDialog
        onCloseAutoFocus={restoreDialogFocus}
        open
        onOpenChange={open => { if (!open) setSwapRequest(null) }}
        recipe={swapRequest.recipe}
        plannedRecipeIds={weeklyPlan?.recipe_ids || []}
        days={weekDays}
        initialDayOfWeek={swapRequest.dayOfWeek}
        onSubmit={handleExplicitSwap}
      />}
      <ShoppingSelectionDialog
        onCloseAutoFocus={restoreDialogFocus}
        open={shoppingRequest !== null}
        onOpenChange={open => { if (!open && !addToShoppingList.isPending) setShoppingRequest(null) }}
        recipes={(recipes || []).filter(recipe => shoppingRequest?.ids.includes(recipe.id))}
        defaultScale={weeklyPlan?.scale ?? 1}
        weekLabel={shoppingRequest?.weekly ? formatWeekLabel(currentWeekDate) : undefined}
        onSubmit={handleShoppingSelectionSubmit}
      />
      <AddRecipeToPlanModal
        onCloseAutoFocus={restoreDialogFocus}
        onAdded={() => {
          // Successful Add can remove or replace its initiating control after
          // delayed reads. Use the persistent originating Planner section.
          dialogTrigger.current = null
        }}
        open={isAddRecipeModalOpen}
        onOpenChange={(open) => { setIsAddRecipeModalOpen(open); if (!open) setAddRecipeTargetDayIndex(null); }}
        weekDate={currentWeekDate}
        targetDayIndex={addRecipeTargetDayIndex}
        weekStartDay={config?.week_start_day ?? 1}
      />

      {/* Regeneration Confirmation Dialog */}
      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace {weeklyPlan?.recipe_ids?.length || 0} existing{" "}
              {weeklyPlan?.recipe_ids?.length === 1 ? "recipe" : "recipes"} in your meal plan.
              Recipes marked as made will be preserved.
            </AlertDialogDescription>
            {plannerGenerationError ? (
              <p className="text-sm text-destructive" role="alert">
                {plannerGenerationError}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeGeneratePlan()}
              disabled={generatePlan.isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {generatePlan.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate New Plan"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Plan Settings Modal */}
      <PlanSettingsModal
        open={isSettingsModalOpen}
        onOpenChange={setIsSettingsModalOpen}
        config={config ?? null}
        currentSelection={selection}
        categories={categories}
        onUpdateConfig={async (updates) => {
          await updateConfig.mutateAsync(updates)
        }}
        onLoadDefault={() => {
          if (config?.default_selection) {
            setSelection(config.default_selection as Record<string, number>)
          }
        }}
        isUpdating={updateConfig.isPending}
      />

      {/* Save Template Dialog */}
      <SaveTemplateDialog
        open={isSaveTemplateOpen}
        onOpenChange={setIsSaveTemplateOpen}
        recipeIds={weeklyPlan?.recipe_ids || []}
        dayAssignments={recipeDayAssignments || null}
        categorySelection={selection}
      />

      {/* Load Template Dialog */}
      <LoadTemplateDialog
        open={isLoadTemplateOpen}
        onOpenChange={setIsLoadTemplateOpen}
        onLoadTemplate={handleLoadTemplate}
        weekLabel={formatWeekLabel(currentWeekDate)}
        currentRecipeCount={weeklyPlan?.recipe_ids?.length || 0}
      />
    </div>
  )

  if (!isDesktop) {
    return plannerContent
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[snapCenterToCursor]}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      {plannerContent}
      <DragOverlay adjustScale={false} dropAnimation={null}>
        {activeRecipe ? (
          <div className="pointer-events-none w-[220px] rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            <div className="relative h-20 w-full">
              {activeRecipeOverlay?.imageUrl ? (
                <Image
                  src={activeRecipeOverlay.imageUrl}
                  alt={activeRecipe.name}
                  fill
                  sizes="220px"
                  unoptimized={activeRecipeOverlay.unoptimized}
                  draggable={false}
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full bg-slate-100 dark:bg-slate-700" />
              )}
              <div
                className="absolute top-2 right-2 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ backgroundColor: getCategoryHexColor(activeRecipe.category) }}
              >
                {activeRecipe.category}
              </div>
            </div>
            <div className="p-3">
              <div className="text-sm font-semibold truncate">{activeRecipe.name}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {activeRecipe.servings} serves
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
