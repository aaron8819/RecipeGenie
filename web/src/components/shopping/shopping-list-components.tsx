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
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

export function formatShoppingItemAmount(item: ShoppingItem): string {
  const parts: string[] = []

  if (item.amount) {
    const amount = toFraction(item.amount)
    parts.push(`${amount}${item.unit ? ` ${item.unit}` : ""}`)
  }

  if (item.additionalAmounts && item.additionalAmounts.length > 0) {
    for (const additional of item.additionalAmounts) {
      if (!additional.amount) continue
      const amount = toFraction(additional.amount)
      parts.push(`${amount}${additional.unit ? ` ${additional.unit}` : ""}`)
    }
  }

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
  onCheckOff: () => void
  onAddToPantry: () => void
  onRemove: () => void
}) {
  const isChecked = item.checked || false
  const amountLabel = formatShoppingItemAmount(item)
  const uniqueSources = dedupeSources(item)
  const nonManualSources = uniqueSources.filter((source) => source.recipeName !== "Manual")
  const sourceSummary = nonManualSources.length === 1
    ? `from ${nonManualSources[0].recipeName}`
    : nonManualSources.length > 1
      ? `from ${nonManualSources.length} recipes`
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
                    className="shrink-0 px-1.5 py-0.5 text-[9px] md:px-2 md:py-0.5 md:text-[10px]"
                  />
                ))
              : null}
          </div>
          {sourceDisplay === "summary" && sourceSummary ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {sourceSummary}
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
          "self-center items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100",
          isDesktop ? "flex" : "hidden"
        )}
      >
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
