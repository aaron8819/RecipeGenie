import React from "react"
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react"
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Leaf,
  MoreVertical,
  Package,
  Pencil,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, toFraction } from "@/lib/utils"
import type { ShoppingItem } from "@/types/database"

const RECIPE_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" },
  { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" },
  { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-200" },
  { bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-200" },
  { bg: "bg-cyan-100", text: "text-cyan-700", border: "border-cyan-200" },
  { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  { bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-200" },
  { bg: "bg-pink-100", text: "text-pink-700", border: "border-pink-200" },
  { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-200" },
]

export function getRecipeColorIndex(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % RECIPE_COLORS.length
}

export function getRecipeColor(index: number) {
  return RECIPE_COLORS[index % RECIPE_COLORS.length]
}

const DISPLAY_UNIT_PLURALS: Record<string, string> = {
  piece: "pieces",
  clove: "cloves",
  slice: "slices",
  can: "cans",
  bunch: "bunches",
  head: "heads",
  stalk: "stalks",
  sprig: "sprigs",
  package: "packages",
  bag: "bags",
  box: "boxes",
  jar: "jars",
  bottle: "bottles",
}

function formatDisplayUnit(amount: number, unit: string): string {
  const trimmedUnit = unit.trim()
  if (!trimmedUnit) return ""

  const sizedPackageMatch = trimmedUnit.match(/^([a-z]+)\s+\((.+)\)$/)
  if (sizedPackageMatch) {
    const singularUnit = sizedPackageMatch[1]
    const packageSize = sizedPackageMatch[2]
    const displayUnit =
      Math.abs(amount) === 1 ? singularUnit : (DISPLAY_UNIT_PLURALS[singularUnit] ?? singularUnit)
    return `${displayUnit} (${packageSize})`
  }

  if (Math.abs(amount) === 1) {
    return trimmedUnit
  }

  return DISPLAY_UNIT_PLURALS[trimmedUnit] ?? trimmedUnit
}

export function formatAmountPart(amount: number | null | undefined, unit: string): string {
  if (!amount) return ""

  const displayAmount = toFraction(amount)
  const displayUnit = formatDisplayUnit(amount, unit)
  return `${displayAmount}${displayUnit ? ` ${displayUnit}` : ""}`
}

export function formatAdditionalAmountParts(
  additionalAmounts: ShoppingItem["additionalAmounts"]
): string[] {
  if (!additionalAmounts || additionalAmounts.length === 0) return []

  return additionalAmounts
    .filter((additional) => Boolean(additional.amount))
    .map((additional) => formatAmountPart(additional.amount, additional.unit))
    .filter(Boolean)
}

export function formatShoppingItemAmount(item: ShoppingItem): string {
  const parts: string[] = []

  const primaryAmount = formatAmountPart(item.amount, item.unit)
  if (primaryAmount) {
    parts.push(primaryAmount)
  }

  parts.push(...formatAdditionalAmountParts(item.additionalAmounts))

  return parts.join(" + ")
}

function dedupeSources(item: ShoppingItem) {
  if (!item.sources) return []

  const seen = new Set<string>()
  return item.sources.filter((source) => {
    if (seen.has(source.recipeName)) return false
    seen.add(source.recipeName)
    return true
  })
}

function buildSourceSummary(sources: ReturnType<typeof dedupeSources>): string | null {
  const nonManualSources = sources.filter((source) => source.recipeName !== "Manual")

  if (nonManualSources.length === 0) {
    return sources.some((source) => source.recipeName === "Manual") ? "Added manually" : null
  }

  if (nonManualSources.length === 1) {
    return `From ${nonManualSources[0].recipeName}`
  }

  if (nonManualSources.length === 2) {
    return `From ${nonManualSources[0].recipeName} and ${nonManualSources[1].recipeName}`
  }

  return `From ${nonManualSources[0].recipeName} + ${nonManualSources.length - 1} more`
}

export function SourceTag({
  recipeName,
  colorIndex,
  onClick,
  className,
}: {
  recipeName: string
  colorIndex?: number
  onClick?: () => void
  className?: string
}) {
  const isManual = recipeName === "Manual"

  if (isManual) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500",
          className
        )}
      >
        Manual
      </span>
    )
  }

  const index =
    colorIndex !== undefined ? colorIndex : getRecipeColorIndex(recipeName)
  const colors = getRecipeColor(index)
  const isTruncated = recipeName.length > 20
  const displayName = isTruncated ? `${recipeName.slice(0, 18)}...` : recipeName
  const baseClasses = `inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text} ${colors.border}`
  const clickableClasses = onClick
    ? "cursor-pointer transition-opacity hover:opacity-80 active:opacity-70"
    : "cursor-default"

  const tagContent = (
    <span
      className={cn(baseClasses, clickableClasses, className)}
      onClick={onClick}
      title={onClick ? `Click to view ${recipeName}` : recipeName}
    >
      {displayName}
    </span>
  )

  if (!isTruncated) {
    return tagContent
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className={cn(baseClasses, "cursor-pointer", className)} title={recipeName}>
          {displayName}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-[200px] p-2 text-sm">
        <div className="flex items-center gap-2">
          <span>{recipeName}</span>
          {onClick ? (
            <button
              onClick={(event) => {
                event.stopPropagation()
                onClick()
              }}
              className="text-xs text-primary hover:underline"
            >
              View recipe
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ShoppingItemRow({
  item,
  isDesktop,
  showDragHandle = false,
  sourceDisplay = "tags",
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  dragHandleProps,
  dragStyle,
  isDragging,
  showSwipeHint,
  onViewRecipe,
  onEdit,
  onCheckOff,
  onAddToPantry,
  onRemove,
}: {
  item: ShoppingItem
  isDesktop: boolean
  showDragHandle?: boolean
  sourceDisplay?: "tags" | "summary" | "none"
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>
  dragStyle?: CSSProperties
  isDragging?: boolean
  showSwipeHint?: boolean
  onViewRecipe?: (recipeId: string | undefined, recipeName: string) => void
  onEdit?: () => void
  onCheckOff: () => void
  onAddToPantry: () => void
  onRemove: () => void
}) {
  const isChecked = item.checked || false
  const amountLabel = formatAmountPart(item.amount, item.unit)
  const additionalAmountLabels = formatAdditionalAmountParts(item.additionalAmounts)
  const uniqueSources = dedupeSources(item)
  const nonManualSources = uniqueSources.filter((source) => source.recipeName !== "Manual")
  const sourceSummary = buildSourceSummary(uniqueSources)
  const singleRecipeSource = nonManualSources.length === 1 ? nonManualSources[0] : null
  const secondaryMetaLabel = additionalAmountLabels.length > 0
    ? `Also: ${additionalAmountLabels.join(", ")}`
    : null

  return (
    <div
      data-testid="shopping-item-row"
      className={cn(
        "group swipeable-content flex min-h-[68px] items-center justify-between px-4 py-3 transition-transform duration-200 ease-out hover:bg-stone-50 md:min-h-[60px] md:px-5",
        showSwipeHint && "animate-swipe-hint"
      )}
      style={{
        ...dragStyle,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {showSwipeHint ? (
        <div
          className={cn(
            "absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background",
            isDesktop && "hidden"
          )}
        >
          Swipe left to delete
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showDragHandle ? (
          <button
            type="button"
            data-drag-handle="true"
            className="flex min-h-[36px] min-w-[36px] touch-none items-center justify-center p-1 text-muted-foreground hover:text-foreground md:min-h-0 md:min-w-0"
            style={{ touchAction: "none" }}
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          data-checkbox="true"
          onClick={onCheckOff}
          disabled={isCheckingOff}
          className="my-0 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center md:min-h-0 md:min-w-0"
          aria-label={isChecked ? "Uncheck item" : "Check off item"}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded border-2 transition-all active:scale-95 md:h-5 md:w-5",
              isChecked
                ? "border-sage-500 bg-sage-500 text-white"
                : "border-sage-300 hover:border-sage-500 hover:bg-sage-100 active:bg-sage-200"
            )}
          >
            {isChecked ? <Check className="h-4 w-4 md:h-3 md:w-3" /> : null}
          </span>
        </button>

        <div className={cn("flex min-h-[44px] min-w-0 flex-1 flex-col justify-center", isChecked && "opacity-60")}>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:gap-2">
            {amountLabel ? (
              <span
                className={cn(
                  "shrink-0 font-bold text-foreground",
                  isChecked && "text-gray-500 line-through"
                )}
              >
                {amountLabel}
              </span>
            ) : null}
            <span
              className={cn(
                "min-w-0 truncate font-medium text-slate-700 md:text-slate-600",
                isChecked && "text-gray-500 line-through"
              )}
            >
              {item.item}
            </span>
            {sourceDisplay === "tags"
              ? uniqueSources.map((source, index) => (
                  <SourceTag
                    key={`${source.recipeName}-${index}`}
                    recipeName={source.recipeName}
                    colorIndex={recipeColorMap.get(source.recipeName)}
                    onClick={
                      source.recipeName !== "Manual" && onViewRecipe
                        ? () => onViewRecipe(source.recipeId, source.recipeName)
                        : undefined
                    }
                    className="shrink-0 px-1.5 py-0.5 text-[9px] md:px-2 md:py-0.5 md:text-[10px]"
                  />
                ))
              : null}
          </div>
          {sourceDisplay === "summary" && sourceSummary ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              {secondaryMetaLabel ? (
                <span className="max-w-full truncate font-medium text-slate-500">
                  {secondaryMetaLabel}
                </span>
              ) : null}
              {singleRecipeSource && onViewRecipe ? (
                <button
                  type="button"
                  onClick={() => onViewRecipe(singleRecipeSource.recipeId, singleRecipeSource.recipeName)}
                  className="max-w-full truncate text-left underline-offset-2 hover:text-foreground hover:underline"
                >
                  {sourceSummary}
                </button>
              ) : (
                <p className="max-w-full truncate">{sourceSummary}</p>
              )}
            </div>
          ) : secondaryMetaLabel ? (
            <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
              {secondaryMetaLabel}
            </p>
          ) : null}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-slate-400 transition-colors hover:bg-stone-100 hover:text-foreground",
              isDesktop && "hidden"
            )}
            aria-label="Item actions"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit item
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onAddToPantry} disabled={isAddingToPantry}>
            <Package className="mr-2 h-4 w-4" />
            Add to pantry
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRemove}
            disabled={isRemoving}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove from list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div
        className={cn(
          "self-center items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          isDesktop ? "flex" : "hidden"
        )}
      >
        {onEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            title="Edit item"
            aria-label="Edit item"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-sage-600"
          onClick={onAddToPantry}
          disabled={isAddingToPantry}
          title="Add to pantry"
          aria-label="Add to pantry"
        >
          <Package className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={isRemoving}
          title="Remove from list"
          aria-label="Remove from list"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function ManualShoppingItemEditor({
  itemName,
  amount,
  unit,
  isSaving,
  errorMessage,
  onItemNameChange,
  onAmountChange,
  onUnitChange,
  onSave,
  onCancel,
}: {
  itemName: string
  amount: string
  unit: string
  isSaving: boolean
  errorMessage?: string | null
  onItemNameChange: (value: string) => void
  onAmountChange: (value: string) => void
  onUnitChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <form
      className="border-t border-stone-100 bg-stone-50/80 px-4 py-3 md:px-5"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Edit manual item</p>
          <p className="text-xs text-muted-foreground">
            Update the name, amount, or unit without removing the row.
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-500">
          Manual
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.6fr)_100px_110px]">
        <Input
          value={itemName}
          onChange={(event) => onItemNameChange(event.target.value)}
          placeholder="Item name"
          aria-label="Manual item name"
          autoFocus
          className="h-10 bg-white"
        />
        <Input
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="Amount"
          aria-label="Manual item amount"
          inputMode="decimal"
          className="h-10 bg-white"
        />
        <Input
          value={unit}
          onChange={(event) => onUnitChange(event.target.value)}
          placeholder="Unit"
          aria-label="Manual item unit"
          className="h-10 bg-white"
        />
      </div>

      {errorMessage ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

export function ShoppingRestoreChip({
  item,
  reasonLabel,
  onRestore,
  disabled,
  recipeColorMap,
  tone = "pantry",
  compact = false,
}: {
  item: ShoppingItem
  reasonLabel: string
  onRestore: () => void
  disabled: boolean
  recipeColorMap: Map<string, number>
  tone?: "pantry" | "excluded"
  compact?: boolean
}) {
  const amountLabel = formatShoppingItemAmount(item)
  const sources = dedupeSources(item).filter((source) => source.recipeName !== "Manual")
  const toneClasses = tone === "excluded"
    ? {
        shell: "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100 active:bg-rose-100",
        badge: "bg-rose-100 text-rose-700",
      }
    : {
        shell: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 active:bg-emerald-100",
        badge: "bg-emerald-100 text-emerald-700",
      }

  return (
    <button
      type="button"
      onClick={onRestore}
      disabled={disabled}
      aria-label={`Restore ${item.item}${amountLabel ? ` ${amountLabel}` : ""} ${reasonLabel}`}
      className={cn(
        "rounded-2xl border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        compact ? "min-h-[44px] px-3 py-2.5" : "px-4 py-3",
        toneClasses.shell
      )}
    >
      <div className="flex min-h-[38px] items-center justify-between gap-3">
        <div className="min-w-0 self-center">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-semibold leading-tight", compact ? "text-sm" : "text-sm")}>
              {item.item}
            </span>
            {amountLabel ? (
              <span className={cn("rounded-full px-2 py-0.5 font-medium", toneClasses.badge, compact ? "text-[10px]" : "text-xs")}>
                {amountLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", toneClasses.badge, compact ? "text-[10px]" : "text-xs")}>
              {reasonLabel}
            </span>
            {sources.map((source, index) => (
              <SourceTag
                key={`${source.recipeName}-${index}`}
                recipeName={source.recipeName}
                colorIndex={recipeColorMap.get(source.recipeName)}
                className={compact ? "text-[9px]" : "text-[10px]"}
              />
            ))}
          </div>
        </div>
      </div>
    </button>
  )
}

type CategoryData = {
  key: string
  name: string
  isCustom: boolean
  checkedCount: number
  uncheckedCount: number
  totalCount: number
}

type ShoppingProgressCategory = {
  key: string
  name: string
  remainingCount: number
}

export function ShoppingProgressSummary({
  remainingCount,
  completedCount,
  totalCount,
  activeCategoryCount,
  hideCompletedItems,
  onToggleCompleted,
  activeCategories,
  onJumpToCategory,
}: {
  remainingCount: number
  completedCount: number
  totalCount: number
  activeCategoryCount: number
  hideCompletedItems: boolean
  onToggleCompleted: () => void
  activeCategories: ShoppingProgressCategory[]
  onJumpToCategory: (categoryKey: string) => void
}) {
  const completionPercent =
    totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0
  const showCompletedToggle = completedCount > 0
  const showJumpChips = activeCategories.length > 1

  return (
    <Card
      className="overflow-hidden rounded-xl border border-stone-100 bg-white shadow-sm"
      data-testid="shopping-progress-summary"
    >
      <CardContent className="px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Progress
              </p>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                {completionPercent}% done
              </span>
              {hideCompletedItems && completedCount > 0 ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  Completed hidden
                </span>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-left">
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Left
                </p>
                <p className="mt-1 text-lg font-semibold text-emerald-950">{remainingCount}</p>
              </div>
              <div className="rounded-xl bg-stone-100 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                  Done
                </p>
                <p className="mt-1 text-lg font-semibold text-stone-700">{completedCount}</p>
              </div>
              <div className="rounded-xl bg-amber-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  Sections
                </p>
                <p className="mt-1 text-lg font-semibold text-amber-900">{activeCategoryCount}</p>
              </div>
            </div>

            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>
          </div>

          {showCompletedToggle ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleCompleted}
              className="h-9 shrink-0 rounded-lg border-stone-200 bg-white px-3 text-xs font-medium"
            >
              {hideCompletedItems ? `Show ${completedCount} done` : `Hide ${completedCount} done`}
            </Button>
          ) : null}
        </div>

        {showJumpChips ? (
          <div className="mt-4 border-t border-stone-100 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Jump to active section
            </p>
            <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {activeCategories.map((category) => (
                <Button
                  key={category.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onJumpToCategory(category.key)}
                  aria-label={`Jump to ${category.name}`}
                  className="h-9 shrink-0 rounded-full border-stone-200 bg-stone-50 px-3 text-xs font-medium text-stone-700 hover:bg-white hover:text-foreground"
                >
                  {category.name}
                  <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-stone-500">
                    {category.remainingCount}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ShoppingCategorySection({
  categoryData,
  itemCount,
  isCollapsed,
  isDragTarget,
  isBulkCheckOffPending,
  onToggleCategory,
  onBulkCheckOff,
  compact = false,
  children,
}: {
  categoryData: CategoryData
  itemCount: number
  isCollapsed: boolean
  isDragTarget: boolean
  isBulkCheckOffPending: boolean
  onToggleCategory: () => void
  onBulkCheckOff: () => void
  compact?: boolean
  children: ReactNode
}) {
  const CategoryIcon = categoryData.key === "produce" ? Leaf : Package
  const remainingCount = categoryData.uncheckedCount
  const completedCount = categoryData.checkedCount

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onToggleCategory()
  }

  const handleCollapseClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggleCategory()
  }

  const handleBulkClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onBulkCheckOff()
  }

  return (
    <Card
      className={cn(
        "animate-fade-in overflow-hidden rounded-xl border border-stone-100 bg-white shadow-sm transition-all duration-200",
        compact && "rounded-lg shadow-xs",
        isDragTarget && "border-2 border-dashed border-primary bg-primary/5"
      )}
    >
      <CardHeader
        role="button"
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-row items-center justify-between border-b border-stone-100 bg-stone-50/50 transition-colors hover:bg-stone-100/50",
          compact ? "px-3 py-2.5 md:px-4 md:py-3" : "px-4 py-3 md:px-6 md:py-4"
        )}
        onClick={onToggleCategory}
        onKeyDown={handleHeaderKeyDown}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 pr-2">
          <CategoryIcon className={cn("shrink-0 text-primary", compact ? "h-4 w-4" : "h-5 w-5")} />
          <CardTitle className={cn(
            "min-w-0 truncate font-display font-semibold uppercase tracking-wide text-foreground",
            compact ? "text-xs md:text-sm" : "text-sm md:text-lg"
          )}>
            {categoryData.name}
          </CardTitle>
          {categoryData.isCustom ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              Custom
            </span>
          ) : null}
          <span className="rounded-full bg-accent-green/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-tight text-primary">
            {remainingCount} left
          </span>
          {completedCount > 0 ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-tight text-stone-500">
              {completedCount} done
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 self-center">
          {itemCount > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBulkClick}
              disabled={isBulkCheckOffPending}
              className={cn(
                "flex min-h-[36px] min-w-[36px] touch-manipulation items-center justify-center px-2 text-[10px] text-primary hover:bg-primary/10 md:min-h-0 md:min-w-0",
                compact ? "h-9 min-w-[44px] md:h-7 md:min-w-[36px]" : "h-9 min-w-[44px] md:h-8"
              )}
              title={`Check all items in ${categoryData.name}`}
              aria-label={`Check all items in ${categoryData.name}`}
            >
              <CheckCheck className="mr-1 h-4 w-4 shrink-0 md:h-3 md:w-3" />
              <span>All</span>
            </Button>
          ) : null}
          <button
            type="button"
            onClick={handleCollapseClick}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-white hover:text-primary"
            aria-label={isCollapsed ? "Expand category" : "Collapse category"}
          >
            {isCollapsed ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronUp className="h-5 w-5" />
            )}
          </button>
        </div>
      </CardHeader>
      {isCollapsed ? null : <CardContent className="p-0">{children}</CardContent>}
    </Card>
  )
}

export function ShoppingStateSection({
  title,
  count,
  icon,
  isDesktop,
  isCollapsed,
  onToggle,
  expandLabel,
  collapseLabel,
  mobileCountClassName,
  desktopCountClassName = "bg-stone-100 text-stone-500",
  mobileContent,
  desktopContent,
}: {
  title: string
  count: number
  icon?: ReactNode
  isDesktop: boolean
  isCollapsed: boolean
  onToggle: () => void
  expandLabel: string
  collapseLabel: string
  mobileCountClassName: string
  desktopCountClassName?: string
  mobileContent: ReactNode
  desktopContent: ReactNode
}) {
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onToggle()
  }

  const handleCollapseClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }

  return (
    <Card className="mb-4 animate-fade-in overflow-hidden rounded-xl border border-stone-100 shadow-sm">
      <CardHeader
        role="button"
        tabIndex={0}
        className={cn(
          "flex flex-row items-center justify-between border-b border-stone-100 bg-stone-50/50 px-4 py-3 cursor-pointer hover:bg-stone-100/50 transition-colors",
          isDesktop && "hidden"
        )}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
      >
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
            {title}
          </CardTitle>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-tighter",
              mobileCountClassName
            )}
          >
            {count}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCollapseClick}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-white hover:text-primary"
          aria-label={isCollapsed ? expandLabel : collapseLabel}
        >
          {isCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
        </button>
      </CardHeader>

      <CardHeader
        className={cn(
          "flex border-b border-stone-100 bg-stone-50/50 px-4 py-3 md:px-6 md:py-4",
          !isDesktop && "hidden"
        )}
      >
        <div className="flex items-center gap-2 md:gap-3">
          {icon}
          <CardTitle className="font-display text-sm font-semibold uppercase tracking-wide text-foreground md:text-lg">
            {title}
          </CardTitle>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              desktopCountClassName
            )}
          >
            {count}
          </span>
        </div>
      </CardHeader>

      {!isCollapsed ? (
        <CardContent className={cn("p-4", isDesktop && "hidden")}>{mobileContent}</CardContent>
      ) : null}

      <CardContent className={cn("p-4 md:p-6", !isDesktop && "hidden")}>
        {desktopContent}
      </CardContent>
    </Card>
  )
}
