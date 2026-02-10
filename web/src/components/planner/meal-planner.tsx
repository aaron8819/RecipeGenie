"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
  Circle,
  ArrowLeftRight,
  Clock,
  History,
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
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
import { RecipeDialog } from "@/components/recipes/recipe-dialog"
import { AddRecipeToPlanModal } from "./add-recipe-to-plan-modal"
import { PlanSettingsModal } from "./plan-settings-modal"
import { SaveTemplateDialog } from "./save-template-dialog"
import { LoadTemplateDialog } from "./load-template-dialog"
import {
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useUserConfig,
  useUpdateUserConfig,
  useGenerateMealPlan,
  useSwapRecipe,
  useMarkRecipeMade,
  useRemoveRecipeFromPlan,
  useAddRecipeToPlan,
  useRecipeHistory,
  useSaveDayAssignments,
  getWeekStartDate,
  navigateWeek,
} from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useCategories, useToggleFavorite, useRecipes } from "@/hooks/use-recipes"
import { EmptyState } from "@/components/ui/empty-state"
import { CalendarDays, BookOpen, Save, FolderOpen } from "lucide-react"
import { getTagClassName, getTagColor } from "@/lib/tag-colors"
import { getCategoryHexColor } from "@/lib/planner-colors"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import {
  parseLocalDate,
  parseLocalCalendarDate,
  toLocalNoonISOString,
  dayIndexToDayOfWeek,
  buildUnassignedDayPriority,
  getUnassignedDayOfWeek,
} from "@/lib/planner-utils"
import { cn } from "@/lib/utils"
import { getSupabase } from "@/lib/supabase/client"
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
 * Recipe stats interface
 */
interface RecipeStats {
  lastMade: string | null
  timesMade: number
}

/**
 * Get stats (last made date + times made count) for each recipe from history
 */
function getRecipeStatsMap(history: RecipeHistory[] | undefined): Map<string, RecipeStats> {
  const statsMap = new Map<string, RecipeStats>()
  if (!history) return statsMap

  // History is already sorted by date_made DESC, so first occurrence is most recent
  for (const entry of history) {
    const existing = statsMap.get(entry.recipe_id)
    if (existing) {
      existing.timesMade += 1
    } else {
      statsMap.set(entry.recipe_id, {
        lastMade: entry.date_made,
        timesMade: 1,
      })
    }
  }
  return statsMap
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
function isDateInWeekRange(dateStr: string, weekStartDate: string): boolean {
  if (!dateStr || !weekStartDate) return false

  const date = parseLocalCalendarDate(dateStr)
  if (!date) return false

  // Parse weekStartDate as YYYY-MM-DD in local time
  const parts = weekStartDate.split("-").map(Number)
  const ys = parts[0]
  const ms = parts[1]
  const ds = parts[2]
  if (isNaN(ys) || isNaN(ms) || isNaN(ds)) return false
  const weekStart = new Date(ys, ms - 1, ds)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  return date >= weekStart && date <= weekEnd
}

function formatLocalISODate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

const RECIPE_DAY_ASSIGNMENTS_KEY = "recipe-genie-recipe-day-assignments"

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
            "text-slate-400 transition-colors disabled:opacity-40",
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
            "text-slate-400 transition-colors disabled:opacity-40",
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

type MobileWeekTab = "today" | "thisWeek" | "nextWeek"
type RecipeDayAssignments = Record<string, number> // recipe_id -> dayIndex (0-6)
type WeekAssignments = Record<string, RecipeDayAssignments> // week_date -> RecipeDayAssignments

/**
 * Parse YYYY-MM-DD as local calendar date (avoid UTC shift from new Date(str)).
 */
/**
 * Get array of day objects for a week
 */
function getWeekDays(weekStartDate: string, weekStartDay: number = 1): Array<{ date: Date; dayName: string; dayNumber: number }> {
  if (!weekStartDate) return []
  
  const startDate = parseLocalDate(weekStartDate)
  const days: Array<{ date: Date; dayName: string; dayNumber: number }> = []
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dayIndex = date.getDay()
    days.push({
      date,
      dayName: dayNames[dayIndex],
      dayNumber: date.getDate(),
    })
  }
  
  return days
}

function EmptySlot({ onAdd, desktop }: { onAdd: () => void; desktop?: boolean }) {
  if (desktop) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="h-[230px] w-full border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-primary dark:hover:border-emerald-500 hover:bg-white dark:hover:bg-slate-800 transition-all group cursor-pointer text-slate-400"
      >
        <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
          <Plus className="h-5 w-5" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide group-hover:text-primary dark:group-hover:text-emerald-400">Add Meal</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      className="h-32 w-full border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-primary hover:bg-white dark:hover:bg-slate-900 transition-all group cursor-pointer"
    >
      <span className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-xs font-bold uppercase tracking-widest group-hover:text-primary">Plan a Meal</span>
    </button>
  )
}

/**
 * Day column component (Desktop) — Stitch redesign
 */
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
  swappingRecipeId,
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
  swappingRecipeId: string | null
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string) => void
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
    <div
      ref={setNodeRef}
      className={cn(
        "space-y-3 rounded-2xl transition-colors",
        isOver && "bg-primary/5 ring-2 ring-primary/30"
      )}
    >
      <div
        className={cn(
          "text-center pb-2",
          isToday && "border-b-4 border-primary dark:border-emerald-500"
        )}
      >
        <p
          className={cn(
            "text-[10px] uppercase tracking-widest font-bold",
            isToday ? "text-primary dark:text-emerald-400" : "text-slate-400"
          )}
        >
          {day.dayName}
        </p>
        <p className={cn("text-2xl font-display font-bold", isToday && "text-primary dark:text-emerald-400")}>
          {day.dayNumber}
        </p>
      </div>
      {mainRecipe ? (
        <div className="space-y-2">
          <FlipRecipeCard key={`day-${dayIndex}-slot-0`} recipe={mainRecipe} slotKey={`day-${dayIndex}-slot-0`}>
            {(displayedRecipe) => (
              <DraggableRecipeCard recipe={displayedRecipe}>
                <StitchRecipeCard
                  compact={false}
                  recipe={displayedRecipe}
                  isMade={isRecipeMade(displayedRecipe)}
                  isMarkingThis={markingRecipeId === mainRecipe.id}
                  isAddingToCart={addingToCartRecipeId === mainRecipe.id}
                  isSwapping={swappingRecipeId === mainRecipe.id}
                  isToday={isToday}
                  onView={() => onViewRecipe(mainRecipe)}
                  onSwap={() => onSwapRecipe(mainRecipe)}
                  onMarkMade={() => onMarkMade(mainRecipe.id, isRecipeMade(mainRecipe))}
                  onAddToCart={() => onAddToCart(mainRecipe.id)}
                  onRemove={() => onRemoveRecipe(mainRecipe)}
                  onMoveToDay={(dayIdx) => onMoveToDay(mainRecipe.id, dayIdx)}
                  weekDays={weekDays}
                  currentDayIndex={currentDayIndex}
                  showMoveToDay={false}
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
                    compact
                    recipe={displayedRecipe}
                    isMade={isRecipeMade(displayedRecipe)}
                    isMarkingThis={markingRecipeId === r.id}
                    isAddingToCart={addingToCartRecipeId === r.id}
                    isSwapping={swappingRecipeId === r.id}
                    isToday={false}
                    onView={() => onViewRecipe(r)}
                    onSwap={() => onSwapRecipe(r)}
                    onMarkMade={() => onMarkMade(r.id, isRecipeMade(r))}
                    onAddToCart={() => onAddToCart(r.id)}
                    onRemove={() => onRemoveRecipe(r)}
                    onMoveToDay={(dayIdx) => onMoveToDay(r.id, dayIdx)}
                    weekDays={weekDays}
                    currentDayIndex={currentDayIndex}
                    showMoveToDay={false}
                    lastMade={statsMap.get(r.id)?.lastMade ?? null}
                    timesMade={statsMap.get(r.id)?.timesMade ?? 0}
                  />
                </DraggableRecipeCard>
              )}
            </FlipRecipeCard>
          ))}
        </div>
      ) : (
        <EmptySlot onAdd={() => onAddMeal(dayIndex)} desktop />
      )}
    </div>
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
  swappingRecipeId,
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
  swappingRecipeId: string | null
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string) => void
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
    <section
      className="space-y-4"
      data-day-index={dayIndex}
      data-day-date={formatLocalISODate(day.date)}
    >
      <div
        className={cn(
          "flex items-baseline justify-between pb-2",
          isToday ? "border-b-2 border-primary/20 dark:border-emerald-500/20" : "border-b border-slate-100 dark:border-slate-800"
        )}
      >
        <h2
          className={cn(
            "text-xl font-display font-bold",
            isToday && "text-primary dark:text-emerald-400"
          )}
        >
          {dayNameLong} <span className="text-slate-400 font-normal ml-1">{day.dayNumber}</span>
        </h2>
      </div>
      {dayRecipes.length > 0 ? (
        dayRecipes.map((recipe, slotIdx) => (
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
                isSwapping={swappingRecipeId === recipe.id}
                isToday={isToday}
                onView={() => onViewRecipe(recipe)}
                onSwap={() => onSwapRecipe(recipe)}
                onMarkMade={() => onMarkMade(recipe.id, isRecipeMade(recipe))}
                onAddToCart={() => onAddToCart(recipe.id)}
                onRemove={() => onRemoveRecipe(recipe)}
                onMoveToDay={(dayIdx) => onMoveToDay(recipe.id, dayIdx)}
                weekDays={weekDays}
                currentDayIndex={currentDayIndex}
                lastMade={statsMap.get(recipe.id)?.lastMade ?? null}
                timesMade={statsMap.get(recipe.id)?.timesMade ?? 0}
              />
            )}
          </FlipRecipeCard>
        ))
      ) : (
        <EmptySlot onAdd={() => onAddMeal(dayIndex)} />
      )}
    </section>
  )
}

/**
 * Stitch-style recipe card (desktop calendar): image, category pill, title, meta, actions.
 * Matches reference/calendarview_redesign_desktop: cooked (accent/COOKED badge), today (border-2 primary), default.
 */
function StitchRecipeCard({
  recipe,
  isMade,
  isMarkingThis,
  isAddingToCart,
  isSwapping,
  isToday,
  onView,
  onSwap,
  onMarkMade,
  onAddToCart,
  onRemove,
  onMoveToDay,
  weekDays,
  currentDayIndex,
  compact = false,
  showMoveToDay = true,
  lastMade = null,
  timesMade = 0,
}: {
  recipe: Recipe
  isMade: boolean
  isMarkingThis: boolean
  isAddingToCart: boolean
  isSwapping: boolean
  isToday?: boolean
  onView: () => void
  onSwap: () => void
  onMarkMade: () => void
  onAddToCart: () => void
  onRemove: () => void
  onMoveToDay: (dayIndex: number) => void
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  compact?: boolean
  showMoveToDay?: boolean
  lastMade?: string | null
  timesMade?: number
}) {
  const pillBg = getCategoryHexColor(recipe.category)
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  const unoptimizedImage = recipeImageUrl ? !recipeImageUrl.includes(".supabase.co") : false

  const cardClasses = cn(
    "relative overflow-hidden flex flex-col border transition-all cursor-pointer rounded-2xl",
    compact ? "min-h-0" : "h-[230px]",
    isMade && "planner-desktop-card-done bg-[#E8EFE9] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 shadow-sm",
    !isMade && isToday && "bg-white dark:bg-slate-800 border-2 border-primary dark:border-emerald-500 shadow-xl",
    !isMade && !isToday && "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg"
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onView() } }}
      className={cardClasses}
    >
      <div className="relative h-24 flex-shrink-0 overflow-hidden">
        {recipeImageUrl ? (
          <Image
            src={recipeImageUrl}
            alt={recipe.name}
            fill
            sizes="(max-width: 768px) 100vw, 320px"
            unoptimized={unoptimizedImage}
            draggable={false}
            className="planner-desktop-card-image object-cover"
          />
        ) : (
          <div className={cn(
            "w-full h-full flex items-center justify-center",
            isMade ? "bg-slate-200 dark:bg-slate-800" : "bg-slate-100 dark:bg-slate-700"
          )}>
            <Clock className="h-8 w-8 text-slate-400 dark:text-slate-500" />
          </div>
        )}
        <div
          className="absolute top-2 right-2 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
          style={{ backgroundColor: pillBg }}
        >
          {recipe.category}
        </div>
      </div>
      <div className="p-3 flex-grow flex flex-col justify-between min-h-0">
        <div>
          <h4 className="font-bold text-sm mb-0.5 leading-tight truncate hover:text-primary transition-colors">
            {recipe.name}
          </h4>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">{recipe.servings} serves</p>
        </div>
        {(timesMade > 0 || lastMade) && (
          <p className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 mt-auto pt-1 pb-1">
            <History className="h-3 w-3 flex-shrink-0" />
            Made {timesMade} time{timesMade !== 1 ? "s" : ""}
            {lastMade && (
              <>
                <span className="text-slate-300 dark:text-slate-600 mx-0.5" aria-hidden>·</span>
                <span>Last: {new Date(lastMade).toLocaleDateString()}</span>
              </>
            )}
          </p>
        )}
        {isMade ? (
          <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 dark:border-slate-700">
            <div className="bg-emerald-600 text-white px-2 py-1 rounded-lg flex items-center gap-1 text-[9px] font-bold">
              <CheckCircle className="h-3.5 w-3.5" />
              COOKED
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove() }}
                className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                title="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            {showMoveToDay && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-slate-400 hover:text-primary"
                    title="Move to another day"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {weekDays.map((d, idx) => (
                    <DropdownMenuItem
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); onMoveToDay(idx) }}
                      disabled={currentDayIndex?.[recipe.id] === d.date.getDay()}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {d.dayName}, {d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMarkMade() }}
              disabled={isMarkingThis}
              className="p-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded text-emerald-600 transition-colors"
              title={isMade ? "Unmark as made" : "Mark as cooked"}
            >
              <CheckCircle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSwap() }}
              disabled={isSwapping}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-500 transition-colors"
              title="Swap recipe"
            >
              {isSwapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddToCart() }}
              disabled={isAddingToCart}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-500 transition-colors"
              title="Add to cart"
            >
              <ShoppingCart className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-slate-400 hover:text-red-500 transition-colors"
              title="Remove"
            >
              <X className="h-4 w-4" />
            </button>
            {showMoveToDay && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-500 transition-colors"
                    title="Move to another day"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {weekDays.map((d, idx) => (
                    <DropdownMenuItem
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); onMoveToDay(idx) }}
                      disabled={currentDayIndex?.[recipe.id] === d.date.getDay()}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {d.dayName}, {d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Mobile-only vertical recipe card — Stitch calendarview_redesign_mobile
 * Image on top (h-44), category tag top-right, title + servings, bottom action row.
 * Done: accent bg, image overlay check, "Recipe Cooked" text. Not done: swap/cart/delete + round check button.
 * Move to day: More (⋮) dropdown with week days, same as desktop.
 */
function MobileRecipeCard({
  recipe,
  isMade,
  isMarkingThis,
  isSwapping,
  isToday,
  onView,
  onSwap,
  onMarkMade,
  onAddToCart,
  onRemove,
  onMoveToDay,
  weekDays,
  currentDayIndex,
  lastMade = null,
  timesMade = 0,
}: {
  recipe: Recipe
  isMade: boolean
  isMarkingThis: boolean
  isSwapping: boolean
  isToday?: boolean
  onView: () => void
  onSwap: () => void
  onMarkMade: () => void
  onAddToCart: () => void
  onRemove: () => void
  onMoveToDay: (dayIndex: number) => void
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  lastMade?: string | null
  timesMade?: number
}) {
  const pillBg = getCategoryHexColor(recipe.category)
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  const unoptimizedImage = recipeImageUrl ? !recipeImageUrl.includes(".supabase.co") : false

  const cardClasses = cn(
    "rounded-3xl overflow-hidden shadow-sm flex flex-col cursor-pointer transition-all",
    isMade &&
      "planner-mobile-card-done bg-emerald-50/80 dark:bg-emerald-950/10 border border-emerald-100/50 dark:border-emerald-900/30",
    !isMade && isToday &&
      "bg-white dark:bg-slate-900 border-2 border-primary dark:border-emerald-500 ring-4 ring-primary/5 dark:ring-emerald-500/20 shadow-xl",
    !isMade && !isToday &&
      "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onView() } }}
      className={cardClasses}
    >
      <div className="relative h-44 flex-shrink-0">
        {recipeImageUrl ? (
          <Image
            src={recipeImageUrl}
            alt={recipe.name}
            fill
            sizes="(max-width: 768px) 100vw, 320px"
            unoptimized={unoptimizedImage}
            draggable={false}
            className="meal-image object-cover"
          />
        ) : (
          <div className="w-full h-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <UtensilsCrossed className="h-14 w-14 text-slate-300 dark:text-slate-600" />
          </div>
        )}
        {isMade && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-12 h-12 bg-white/90 dark:bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
              <CheckCircle className="h-7 w-7 text-emerald-600 dark:text-white" />
            </span>
          </div>
        )}
        <span
          className="absolute top-4 right-4 text-white text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider"
          style={{ backgroundColor: pillBg }}
        >
          {recipe.category}
        </span>
      </div>
      <div className="p-5 flex flex-col flex-grow">
        <div className="mb-4">
          <h3 className="font-bold text-lg mb-1 leading-tight">{recipe.name}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{recipe.servings} serves</p>
        </div>
        {(timesMade > 0 || lastMade) && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-auto pt-1 pb-3">
            <History className="h-3.5 w-3 flex-shrink-0" />
            Made {timesMade} time{timesMade !== 1 ? "s" : ""}
            {lastMade && (
              <>
                <span className="text-slate-300 dark:text-slate-600 mx-0.5" aria-hidden>·</span>
                <span>Last: {new Date(lastMade).toLocaleDateString()}</span>
              </>
            )}
          </p>
        )}
        <div
          className={cn(
            "flex items-center justify-between pt-4",
            isMade
              ? "border-t border-emerald-100 dark:border-emerald-900/50"
              : "border-t border-slate-50 dark:border-slate-800/50"
          )}
        >
          <div className="flex items-center gap-6">
            {!isMade ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onMarkMade() }}
                  disabled={isMarkingThis}
                  className={cn(
                    "flex flex-col items-center gap-1 transition-all shrink-0 w-10 h-10 rounded-full justify-center",
                    isToday
                      ? "bg-primary/10 dark:bg-emerald-500/10 text-primary dark:text-emerald-400 border border-primary/20 dark:border-emerald-500/20 shadow-sm"
                      : "border border-slate-200 dark:border-slate-700 text-slate-300 hover:text-emerald-500 hover:border-emerald-500"
                  )}
                  title="Mark as cooked"
                >
                  {isMarkingThis ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSwap() }}
                  disabled={isSwapping}
                  className={cn(
                    "flex flex-col items-center gap-1 transition-colors",
                    isToday ? "text-primary dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800" : "text-slate-400 hover:text-primary"
                  )}
                  title="Swap"
                >
                  {isSwapping ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowLeftRight className="h-5 w-5" />}
                </button>
              </>
            ) : null}
            {!isMade && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddToCart() }}
                className="flex flex-col items-center gap-1 text-slate-400 hover:text-primary transition-colors"
                title="Add to cart"
              >
                <ShoppingCart className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="flex flex-col items-center gap-1 text-slate-400 hover:text-red-500 transition-colors"
              title="Remove"
            >
              <X className="h-5 w-5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-col items-center gap-1 text-slate-400 hover:text-primary transition-colors"
                  aria-label="Move to another day"
                >
                  <CalendarIcon className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {weekDays.map((d, idx) => (
                  <DropdownMenuItem
                    key={idx}
                    onClick={(e) => { e.stopPropagation(); onMoveToDay(idx) }}
                    disabled={currentDayIndex?.[recipe.id] === d.date.getDay()}
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {d.dayName}, {d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isMade ? (
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
              Recipe Cooked
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function MealPlanner() {
  // Default to current week (client local date); syncs to user's week_start_day when config loads
  const [currentWeekDate, setCurrentWeekDate] = useState<string>(() =>
    getWeekStartDate(new Date(), 1)
  )
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [markingRecipeId, setMarkingRecipeId] = useState<string | null>(null)
  const [addingToCartRecipeId, setAddingToCartRecipeId] = useState<string | null>(null)
  const [swappingRecipeId, setSwappingRecipeId] = useState<string | null>(null)
  const [pendingRemovalRecipeIds, setPendingRemovalRecipeIds] = useState<Set<string>>(new Set())
  const [isAddRecipeModalOpen, setIsAddRecipeModalOpen] = useState(false)
  const [addRecipeTargetDayIndex, setAddRecipeTargetDayIndex] = useState<number | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isDatePickerOpenMobile, setIsDatePickerOpenMobile] = useState(false)
  const [isDatePickerOpenDesktop, setIsDatePickerOpenDesktop] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false)
  const [isLoadTemplateOpen, setIsLoadTemplateOpen] = useState(false)
  const [mobileWeekTab, setMobileWeekTab] = useState<MobileWeekTab>("thisWeek")
  const mobileDaysContainerRef = useRef<HTMLDivElement>(null)
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null)
  const [localDayAssignments, setLocalDayAssignments] = useState<Record<string, number> | null>(null)
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return window.matchMedia("(min-width: 1024px)").matches
  })

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

  const { data: config } = useUserConfig()
  const updateConfig = useUpdateUserConfig()
  const { data: weeklyPlan, isLoading: planLoading } = useWeeklyPlan(currentWeekDate)

  // Get day assignments from the weekly plan (database) with localStorage fallback
  const recipeDayAssignments = useMemo(() => {
    if (localDayAssignments) return localDayAssignments
    // First try to get from database (weekly plan)
    if (weeklyPlan?.day_assignments) {
      return weeklyPlan.day_assignments
    }
    // Fallback to localStorage for backward compatibility
    if (typeof window !== "undefined" && currentWeekDate) {
      try {
        const stored = localStorage.getItem(RECIPE_DAY_ASSIGNMENTS_KEY)
        if (stored) {
          const parsed = JSON.parse(stored)
          if (parsed && typeof parsed === "object" && parsed.version === 2 && parsed.weeks) {
            return parsed.weeks[currentWeekDate] || {}
          }
          const allAssignments: WeekAssignments = parsed
          const legacyAssignments = allAssignments[currentWeekDate] || {}
          // Legacy localStorage stored week-grid indices; convert to absolute day-of-week
          const weekStartDay = config?.week_start_day ?? 1
          return Object.fromEntries(
            Object.entries(legacyAssignments).map(([recipeId, dayIndex]) => [
              recipeId,
              dayIndexToDayOfWeek(dayIndex, weekStartDay),
            ])
          )
        }
      } catch {
        // Ignore parse errors
      }
    }
    return {}
  }, [localDayAssignments, weeklyPlan?.day_assignments, currentWeekDate, config?.week_start_day])

  useEffect(() => {
    if (weeklyPlan?.day_assignments) {
      setLocalDayAssignments(weeklyPlan.day_assignments)
    }
  }, [weeklyPlan?.day_assignments])

  // Get week days for calendar view (needed early for handleMarkMade)
  const weekDays = useMemo(() => {
    return getWeekDays(currentWeekDate, config?.week_start_day || 1)
  }, [currentWeekDate, config?.week_start_day])

  // Mobile: filter to today only when "Today" tab, else all days
  const mobileDays = useMemo(() => {
    if (mobileWeekTab === "today") {
      const t = new Date().toDateString()
      return weekDays.filter((d) => d.date.toDateString() === t)
    }
    return weekDays
  }, [weekDays, mobileWeekTab])

  // Compute effective tab based on currentWeekDate to keep visual indicator in sync
  // This prevents tab/date desync when using chevron navigation beyond this/next week
  const effectiveTab = useMemo((): MobileWeekTab | null => {
    if (mobileWeekTab === "today") return "today"
    const thisWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
    const nextWeekStart = navigateWeek(thisWeekStart, "next")
    if (currentWeekDate === thisWeekStart) return "thisWeek"
    if (currentWeekDate === nextWeekStart) return "nextWeek"
    return null // No tab matches (viewing a different week)
  }, [currentWeekDate, mobileWeekTab, config?.week_start_day])

  const scrollToDay = useCallback((date: Date) => {
    const key = formatLocalISODate(date)
    const target = mobileDaysContainerRef.current?.querySelector<HTMLElement>(
      `[data-day-date="${key}"]`
    )
    if (!target) return
    target.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [])

  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])
  const { data: history } = useRecipeHistory()
  const { data: allCategories } = useCategories()
  const { data: allRecipes } = useRecipes({ select: "id", limit: 1 })
  const hasAnyRecipes = (allRecipes?.length ?? 0) > 0

  const generatePlan = useGenerateMealPlan()
  const swapRecipe = useSwapRecipe()
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
  const statsMap = useMemo(() => getRecipeStatsMap(history), [history])

  // Sync to current week when config first loads (user's week_start_day)
  const hasSyncedInitialWeekRef = useRef(false)
  const markUserNavigated = useCallback(() => {
    hasSyncedInitialWeekRef.current = true
  }, [])
  useEffect(() => {
    if (hasSyncedInitialWeekRef.current) return
    if (!config?.week_start_day) return
    const weekStart = getWeekStartDate(new Date(), config.week_start_day)
    setCurrentWeekDate(weekStart)
    hasSyncedInitialWeekRef.current = true
  }, [config?.week_start_day])

  // Initialize selection from config
  useEffect(() => {
    if (config?.default_selection) {
      setSelection(config.default_selection as Record<string, number>)
    }
  }, [config?.default_selection])

  const handlePrevWeek = () => {
    markUserNavigated()
    const next = navigateWeek(currentWeekDate, "prev")
    setCurrentWeekDate(next)
    const thisWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
    const nextWeekStart = navigateWeek(thisWeekStart, "next")
    if (next === thisWeekStart) setMobileWeekTab("thisWeek")
    else if (next === nextWeekStart) setMobileWeekTab("nextWeek")
  }

  const handleNextWeek = () => {
    markUserNavigated()
    const next = navigateWeek(currentWeekDate, "next")
    setCurrentWeekDate(next)
    const thisWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
    const nextWeekStart = navigateWeek(thisWeekStart, "next")
    if (next === thisWeekStart) setMobileWeekTab("thisWeek")
    else if (next === nextWeekStart) setMobileWeekTab("nextWeek")
  }

  const handleMobileWeekTab = (tab: MobileWeekTab) => {
    markUserNavigated()
    setMobileWeekTab(tab)
    const thisWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
    const nextWeekStart = navigateWeek(thisWeekStart, "next")
    if (tab === "today" || tab === "thisWeek") setCurrentWeekDate(thisWeekStart)
    else if (tab === "nextWeek") setCurrentWeekDate(nextWeekStart)
  }

  const handleGeneratePlan = () => {
    if (!currentWeekDate) return
    // Show confirmation if there are existing recipes
    if (weeklyPlan?.recipe_ids && weeklyPlan.recipe_ids.length > 0) {
      setShowRegenerateConfirm(true)
    } else {
      executeGeneratePlan()
    }
  }

  const executeGeneratePlan = async () => {
    if (!currentWeekDate) return
    setShowRegenerateConfirm(false)
    await generatePlan.mutateAsync({ weekDate: currentWeekDate, selection })
  }

  const handleGenerateShoppingList = async () => {
    if (!weeklyPlan?.recipe_ids || weeklyPlan.recipe_ids.length === 0) return
    try {
      const result = await addToShoppingList.mutateAsync({ recipeIds: weeklyPlan.recipe_ids })
      
      // Show success message based on what happened
      let message = ""
      if (result.added > 0 && result.merged > 0) {
        message = `${result.added} item${result.added !== 1 ? "s" : ""} added, ${result.merged} item${result.merged !== 1 ? "s" : ""} merged to shopping list`
      } else if (result.added > 0) {
        message = `${result.added} item${result.added !== 1 ? "s" : ""} added to shopping list`
      } else if (result.merged > 0) {
        message = `${result.merged} item${result.merged !== 1 ? "s" : ""} merged to shopping list`
      } else {
        message = "All items already in shopping list"
      }
      
      undoToast.show({
        message,
        duration: 4000,
      })
    } catch (error) {
      // Error handling is done by the mutation itself
      console.error("Failed to add to shopping list:", error)
    }
  }

  const handleLoadTemplate = async (template: PlanTemplate) => {
    if (!currentWeekDate) return
    try {
      // Filter out deleted recipes
      const { data: recipeRows } = await getSupabase()
        .from('recipes')
        .select('id')
      const existingRecipeIds = new Set(
        (recipeRows as { id: string }[] || [])
          .map(r => r.id)
      )
      const validIds = template.recipe_ids.filter(
        (id) => existingRecipeIds.has(id)
      )
      const missing =
        template.recipe_ids.length - validIds.length

      await saveWeeklyPlan.mutateAsync({
        weekDate: currentWeekDate,
        recipeIds: validIds,
      })

      // Apply day assignments if present
      if (template.day_assignments) {
        // Filter assignments to only include valid recipes
        const validAssignments = Object.fromEntries(
          Object.entries(template.day_assignments)
            .filter(([id]) => existingRecipeIds.has(id))
        )
        setLocalDayAssignments(validAssignments)
        saveDayAssignments.mutate({
          weekDate: currentWeekDate,
          dayAssignments: validAssignments,
        })
      }

      // Apply category selection if present
      if (template.category_selection) {
        setSelection(
          template.category_selection as Record<string, number>
        )
      }

      let msg = `Template "${template.name}" loaded`
      if (missing > 0) {
        msg += ` (${missing} deleted recipe${missing !== 1 ? 's' : ''} removed)`
      }
      undoToast.show({ message: msg, duration: 4000 })
    } catch (error) {
      console.error('Failed to load template:', error)
    }
  }

  const handleSwapRecipe = async (recipe: Recipe) => {
    if (!currentWeekDate) return
    setSwappingRecipeId(recipe.id)
    try {
      await swapRecipe.mutateAsync({
        weekDate: currentWeekDate,
        oldRecipeId: recipe.id,
        category: recipe.category,
        excludeIds: weeklyPlan?.recipe_ids || [],
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
    } finally {
      setMarkingRecipeId(null)
    }
  }, [currentWeekDate, recipes, markMade, undoToast, recipeDayAssignments, weekDays])

  const handleRemoveFromPlan = useCallback((recipe: Recipe) => {
    if (!currentWeekDate) return
    setPendingRemovalRecipeIds((prev) => new Set(prev).add(recipe.id))
    undoToast.show({
      message: `"${recipe.name}" removed from plan`,
      onUndo: () => {
        setPendingRemovalRecipeIds((prev) => {
          const next = new Set(prev)
          next.delete(recipe.id)
          return next
        })
      },
      onExpire: () => {
        removeFromPlan.mutate({ weekDate: currentWeekDate, recipeId: recipe.id })
        setPendingRemovalRecipeIds((prev) => {
          const next = new Set(prev)
          next.delete(recipe.id)
          return next
        })
      },
    })
  }, [currentWeekDate, undoToast, removeFromPlan])

  const handleAddRecipeToCart = async (recipeId: string) => {
    setAddingToCartRecipeId(recipeId)
    try {
      await addToShoppingList.mutateAsync({ recipeIds: [recipeId] })
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
    setLocalDayAssignments(updatedAssignments)
    
    // Save to database
    saveDayAssignments.mutate({
      weekDate: currentWeekDate,
      dayAssignments: updatedAssignments,
    })
    
    // Also update localStorage as fallback
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(RECIPE_DAY_ASSIGNMENTS_KEY)
        const parsed = stored ? JSON.parse(stored) : null
        let allAssignments: WeekAssignments = {}
        if (parsed && typeof parsed === "object" && parsed.version === 2 && parsed.weeks) {
          allAssignments = parsed.weeks
        } else if (parsed) {
          allAssignments = parsed as WeekAssignments
        }
        allAssignments[currentWeekDate] = updatedAssignments
        localStorage.setItem(
          RECIPE_DAY_ASSIGNMENTS_KEY,
          JSON.stringify({ version: 2, weeks: allAssignments })
        )
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [currentWeekDate, recipeDayAssignments, saveDayAssignments, config?.week_start_day])

  const formatWeekLabel = (dateStr: string) => {
    if (!dateStr) return ""
    const date = parseLocalDate(dateStr)
    const endDate = new Date(date)
    endDate.setDate(endDate.getDate() + 6)

    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
    return `${date.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`
  }

  const categories = allCategories || config?.categories || []
  const totalMeals = Object.values(selection).reduce((sum, n) => sum + n, 0)

  // Filter out pending removal recipes
  const displayedRecipes = recipes?.filter(r => !pendingRemovalRecipeIds.has(r.id))
  const activeRecipe = activeRecipeId
    ? (displayedRecipes || []).find((r) => r.id === activeRecipeId) || null
    : null
  const activeRecipeImageUrl = activeRecipe ? getRecipeImageUrl(activeRecipe.image_url) : null
  const activeRecipeUnoptimized = activeRecipeImageUrl ? !activeRecipeImageUrl.includes(".supabase.co") : false

  // Build day priority for distributing unassigned recipes (preferred first, then available)
  const unassignedDayPriority = useMemo(
    () => buildUnassignedDayPriority(config?.excluded_days || [], config?.preferred_days || null),
    [config?.excluded_days, config?.preferred_days]
  )

  // Get recipes assigned to each day
  const getRecipesByDay = useCallback((dayIndex: number): Recipe[] => {
    if (!displayedRecipes) return []

    const day = weekDays[dayIndex]
    const dayOfWeek = day ? day.date.getDay() : dayIndex

    // Get recipes explicitly assigned to this day-of-week
    const assignedRecipes = displayedRecipes.filter(
      recipe => recipeDayAssignments[recipe.id] === dayOfWeek
    )
    
    // Distribute unassigned recipes evenly across days using stable ID-based hash
    // This ensures recipes don't shift days when other recipes are added/removed
    const unassignedForThisDay = displayedRecipes.filter((recipe) => {
      // Only include if it's unassigned AND the stable hash maps to this day
      if (recipeDayAssignments[recipe.id] !== undefined) return false
      const assignedDayOfWeek = getUnassignedDayOfWeek(recipe.id, unassignedDayPriority)
      return assignedDayOfWeek === dayOfWeek
    })
    
    // Combine assigned recipes with unassigned recipes for this day
    return [...assignedRecipes, ...unassignedForThisDay]
  }, [displayedRecipes, recipeDayAssignments, weekDays, unassignedDayPriority])

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

    const targetDayOfWeek = weekDays[targetDayIndex].date.getDay()
    if (recipeDayAssignments[recipeId] === targetDayOfWeek) return

    handleMoveToDay(recipeId, targetDayIndex)
  }, [handleMoveToDay, recipeDayAssignments, weekDays])

  // Check if displayed week is the current week
  const currentWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
  const isCurrentWeek = currentWeekDate === currentWeekStart

  // Calculate progress (made recipes / total recipes)
  const progress = useMemo(() => {
    if (!displayedRecipes || displayedRecipes.length === 0) return { made: 0, total: 0, percentage: 0 }
    
    const madeCount = displayedRecipes.filter(recipe => {
      const isManuallyMarked = weeklyPlan?.made_recipe_ids?.includes(recipe.id) || false
      const lastMade = lastMadeMap.get(recipe.id)
      const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
      return isManuallyMarked || isMadeInWeek
    }).length
    
    return {
      made: madeCount,
      total: displayedRecipes.length,
      percentage: displayedRecipes.length > 0 ? Math.round((madeCount / displayedRecipes.length) * 100) : 0,
    }
  }, [displayedRecipes, weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  // Helper to check if recipe is made
  const isRecipeMade = useCallback((recipe: Recipe): boolean => {
    const isManuallyMarked = weeklyPlan?.made_recipe_ids?.includes(recipe.id) || false
    const lastMade = lastMadeMap.get(recipe.id)
    const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
    return isManuallyMarked || isMadeInWeek
  }, [weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  const plannerContent = (
    <div className="space-y-6 pb-6">
      {/* Mobile: compact schedule (planner_mobile_redesign) */}
      <div className="lg:hidden space-y-4">
        <div className="bg-card-cream rounded-xl p-4 shadow-sm border border-border-muted">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-sm font-semibold text-primary">{formatWeekLabel(currentWeekDate)}</span>
            {mobileWeekTab !== "today" && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handlePrevWeek}
                  className="p-2 rounded-lg bg-white border border-border-muted hover:bg-white/90 transition-colors"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextWeek}
                  className="p-2 rounded-lg bg-white border border-border-muted hover:bg-white/90 transition-colors"
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <Popover open={isDatePickerOpenMobile} onOpenChange={setIsDatePickerOpenMobile}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="p-2 rounded-lg bg-white border border-border-muted hover:bg-white/90 transition-colors"
                      title="Pick a date to jump to that week"
                      aria-label="Open calendar to pick a week"
                    >
                      <CalendarIcon className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      selected={currentWeekDate ? parseLocalDate(currentWeekDate) : undefined}
                      onSelect={(date) => {
                      if (date) {
                        markUserNavigated()
                        const weekStart = getWeekStartDate(date, config?.week_start_day || 1)
                        setCurrentWeekDate(weekStart)
                        setIsDatePickerOpenMobile(false)
                          const thisWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
                          const nextWeekStart = navigateWeek(thisWeekStart, "next")
                          if (weekStart === thisWeekStart) setMobileWeekTab("thisWeek")
                          else if (weekStart === nextWeekStart) setMobileWeekTab("nextWeek")
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-primary/80">Weekly Progress</span>
              <span className="font-bold text-primary">{progress.made} of {progress.total} meals</span>
            </div>
            <div className="w-full bg-white/80 h-2 rounded-full overflow-hidden border border-border-muted">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: Current Schedule + Quick Meal Mix — Stitch 2-col layout */}
      {isDesktop && (
      <div className="hidden lg:grid lg:grid-cols-12 gap-6">
        {/* Current Schedule */}
        <div className="lg:col-span-4 bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-sm border border-stone-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">
                Current Schedule
              </p>
              <h2 className="text-2xl font-display text-slate-800 dark:text-white">
                {formatWeekLabel(currentWeekDate)}
              </h2>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleNextWeek}
                className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <Popover open={isDatePickerOpenDesktop} onOpenChange={setIsDatePickerOpenDesktop}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                    title="Pick a date to jump to that week"
                    aria-label="Open calendar to pick a week"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" side="bottom">
                  <Calendar
                    selected={currentWeekDate ? parseLocalDate(currentWeekDate) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        markUserNavigated()
                        const weekStart = getWeekStartDate(date, config?.week_start_day || 1)
                        setCurrentWeekDate(weekStart)
                        setIsDatePickerOpenDesktop(false)
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-sm font-medium">Weekly Progress</span>
              <span className="text-sm font-bold text-primary">
                {progress.made} of {progress.total} meals
              </span>
            </div>
            <div className="w-full bg-stone-100 dark:bg-zinc-800 h-3 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300 ease-in-out"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              You&apos;re on track to hit your nutrition goals!
            </p>
          </div>
        </div>

        {/* Quick Meal Mix */}
        <div className="lg:col-span-8 bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-sm border border-stone-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
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
          </div>
          <div className="flex flex-wrap gap-4">
            {categories.map((category: string) => (
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
        </div>
      </div>
      )}

      {/* Week navigation (mobile) + Add to Cart */}
      <div className="space-y-4 -mt-3 lg:mt-0">
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
        {/* Mobile: Today | This Week | Next Week (ref: planner_mobile_redesign) */}
        <nav className="lg:hidden flex border-b border-border-muted">
          {(["today", "thisWeek", "nextWeek"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleMobileWeekTab(tab)}
              className={cn(
                "flex-1 py-3 text-xs font-bold border-b-2 transition-colors",
                effectiveTab === tab
                  ? "text-primary border-primary"
                  : "text-primary/60 border-transparent"
              )}
            >
              {tab === "today" ? "Today" : tab === "thisWeek" ? "This Week" : "Next Week"}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 lg:ml-auto shrink-0 overflow-x-auto pb-1 lg:pb-0 scrollbar-thin">
          <Button
            onClick={() => { setAddRecipeTargetDayIndex(null); setIsAddRecipeModalOpen(true); }}
            disabled={!hasAnyRecipes}
            variant="outline"
            size="default"
            className="shrink-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Add recipe</span>
            <span className="sm:hidden">Add</span>
          </Button>
          <Button
            onClick={handleGenerateShoppingList}
            disabled={addToShoppingList.isPending || !displayedRecipes?.length}
            variant="outline"
            size="default"
            className="shrink-0 border-2 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary"
          >
            {addToShoppingList.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4 mr-2" />
            )}
            Cart
          </Button>
          <Button
            onClick={() => setIsSaveTemplateOpen(true)}
            disabled={!displayedRecipes?.length}
            variant="outline"
            size="default"
            title="Save current plan as template"
            className="shrink-0"
          >
            <Save className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Save Template</span>
            <span className="sm:hidden">Save</span>
          </Button>
          <Button
            onClick={() => setIsLoadTemplateOpen(true)}
            variant="outline"
            size="default"
            title="Load a saved template"
            className="shrink-0"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Load Template</span>
            <span className="sm:hidden">Load</span>
          </Button>
        </div>
      </div>

      {planLoading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : !displayedRecipes || displayedRecipes.length === 0 ? (
          !hasAnyRecipes ? (
            <EmptyState
              icon={BookOpen}
              title="Add recipes first"
              description="You need recipes before you can plan your meals. Start by adding some recipes to your collection."
            />
          ) : (
            <>
              {/* Mobile: category selection + Generate Plan when week has no meals */}
              <div className="lg:hidden flex flex-col items-center py-8 px-4">
                <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
                  Plan your week
                </h3>
                <p className="text-muted-foreground max-w-sm mb-6 text-center">
                  Select how many meals you want for each category, then generate a meal plan.
                </p>
                <div className="w-full max-w-md flex flex-wrap gap-3 justify-center mb-6">
                  {categories.map((category: string) => (
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
                    onClick={() => { setAddRecipeTargetDayIndex(null); setIsAddRecipeModalOpen(true); }}
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
              </div>
              {/* Desktop: calendar week with Add meal on each day */}
              {isDesktop && (
              <div className="hidden lg:flex items-start gap-2">
                <button
                  type="button"
                  onClick={handlePrevWeek}
                  className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
                </button>
                <div className="flex-1 min-w-0 grid grid-cols-7 gap-4">
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
                        swappingRecipeId={swappingRecipeId}
                        onViewRecipe={setViewingRecipe}
                        onSwapRecipe={handleSwapRecipe}
                        onMarkMade={handleMarkMade}
                        onAddToCart={handleAddRecipeToCart}
                        onRemoveRecipe={handleRemoveFromPlan}
                        onMoveToDay={handleMoveToDay}
                        onAddMeal={(d) => { setAddRecipeTargetDayIndex(d ?? null); setIsAddRecipeModalOpen(true); }}
                        weekDays={weekDays}
                        currentDayIndex={recipeDayAssignments}
                        isToday={isToday}
                        statsMap={statsMap}
                      />
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleNextWeek}
                  className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
                  aria-label="Next week"
                >
                  <ChevronRight className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
                </button>
              </div>
              )}
            </>
          )
        ) : (
          <>
            {/* Desktop: Calendar View (7-day grid) with week navigation */}
            {isDesktop && (
            <div className="hidden lg:flex items-start gap-2">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
              </button>
              <div className="flex-1 min-w-0 grid grid-cols-7 gap-4">
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
                      swappingRecipeId={swappingRecipeId}
                      onViewRecipe={setViewingRecipe}
                      onSwapRecipe={handleSwapRecipe}
                      onMarkMade={handleMarkMade}
                      onAddToCart={handleAddRecipeToCart}
                      onRemoveRecipe={handleRemoveFromPlan}
                      onMoveToDay={handleMoveToDay}
                      onAddMeal={(dayIndex) => { setAddRecipeTargetDayIndex(dayIndex ?? null); setIsAddRecipeModalOpen(true); }}
                      weekDays={weekDays}
                      currentDayIndex={recipeDayAssignments}
                      isToday={isToday}
                      statsMap={statsMap}
                    />
                  )
                })}
              </div>
              <button
                type="button"
                onClick={handleNextWeek}
                className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
                aria-label="Next week"
              >
                <ChevronRight className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
              </button>
            </div>
            )}

            {/* Mobile: calendar view — Stitch calendarview_redesign_mobile: week strip + day sections */}
            <div className="lg:hidden space-y-6">
              {mobileWeekTab !== "today" && (
                <div className="flex items-center justify-between overflow-x-auto scrollbar-hide gap-4 py-2">
                  {weekDays.map((d) => {
                    const isToday = d.date.toDateString() === new Date().toDateString()
                    return (
                      <div key={d.date.toISOString()} className={cn("flex flex-col items-center min-w-[50px] relative flex-shrink-0")}>
                        <span className={cn("text-[10px] uppercase tracking-widest font-bold", isToday ? "text-primary dark:text-emerald-400" : "text-slate-400")}>
                          {d.dayName}
                        </span>
                        <button
                          type="button"
                          onClick={() => scrollToDay(d.date)}
                          className={cn(
                            "text-lg font-display font-medium transition-colors",
                            isToday && "font-bold text-primary dark:text-emerald-400",
                            !isToday && "text-slate-700 dark:text-slate-200 hover:text-primary dark:hover:text-emerald-300"
                          )}
                          aria-label={`Scroll to ${d.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
                        >
                          {d.dayNumber}
                        </button>
                        {isToday && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary dark:bg-emerald-400 rounded-full" />}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="space-y-10" ref={mobileDaysContainerRef}>
                {mobileDays.map((day) => {
                  const dayIndex = weekDays.findIndex((w) => w.date.toDateString() === day.date.toDateString())
                  const dayRecipes = getRecipesByDay(dayIndex >= 0 ? dayIndex : 0)
                  return (
                    <MobileDayColumn
                      key={day.date.toISOString()}
                      day={day}
                      dayIndex={dayIndex >= 0 ? dayIndex : 0}
                      dayRecipes={dayRecipes}
                      isRecipeMade={isRecipeMade}
                      markingRecipeId={markingRecipeId}
                      swappingRecipeId={swappingRecipeId}
                      onViewRecipe={setViewingRecipe}
                      onSwapRecipe={handleSwapRecipe}
                      onMarkMade={handleMarkMade}
                      onAddToCart={handleAddRecipeToCart}
                      onRemoveRecipe={handleRemoveFromPlan}
                      onMoveToDay={handleMoveToDay}
                      onAddMeal={(dayIndex) => { setAddRecipeTargetDayIndex(dayIndex ?? null); setIsAddRecipeModalOpen(true); }}
                      weekDays={weekDays}
                      currentDayIndex={recipeDayAssignments}
                      statsMap={statsMap}
                    />
                  )
                })}
              </div>
            </div>

          </>
        )}
      </div>

      {/* Recipe Detail Dialog */}
      <RecipeDetailDialog
        open={!!viewingRecipe}
        onOpenChange={(open) => !open && setViewingRecipe(null)}
        recipe={viewingRecipe}
        onEdit={(r) => {
          setViewingRecipe(null)
          setEditingRecipe(r)
        }}
        lastMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.lastMade ?? null : null}
        timesMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.timesMade ?? 0 : 0}
      />

      {/* Edit Recipe Dialog */}
      <RecipeDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        recipe={editingRecipe || undefined}
        categories={allCategories || []}
      />

      {/* Add Recipe to Plan Modal */}
      <AddRecipeToPlanModal
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
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeGeneratePlan}
              className="bg-primary hover:bg-primary/90"
            >
              Generate New Plan
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
              {activeRecipeImageUrl ? (
                <Image
                  src={activeRecipeImageUrl}
                  alt={activeRecipe.name}
                  fill
                  sizes="220px"
                  unoptimized={activeRecipeUnoptimized}
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

