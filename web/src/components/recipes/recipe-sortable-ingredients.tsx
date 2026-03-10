"use client"

// This file is lazy-loaded via next/dynamic in recipe-dialog.tsx so that the
// @dnd-kit bundle (~60–90 KB gzipped) is excluded from the initial JS payload
// and only fetched when the recipe dialog is first opened.

import React, { useState, useEffect } from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn, toFraction } from "@/lib/utils"
import { parseIngredientLine } from "@/lib/recipe-parser"
import type { Ingredient } from "@/types/database"
import {
  validateIngredient,
  type IngredientValidationIssue,
} from "./recipe-dialog.validation"

// ─── constants / helpers ─────────────────────────────────────────────────────

const COMMON_UNITS = [
  "tsp", "tbsp", "cup", "oz", "fl oz", "lb",
  "g", "kg", "ml", "l",
  "pt", "qt", "gal",
  "can", "clove", "head", "piece", "slice", "pinch", "dash", "pkg",
]

function parseAmountStr(str: string): number | null {
  const trimmed = str.trim()
  if (!trimmed) return null
  if (trimmed.includes('/')) {
    const [num, den] = trimmed.split('/').map((s) => parseFloat(s.trim()))
    if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den
    return null
  }
  const n = parseFloat(trimmed)
  return isNaN(n) ? null : n
}

function getValidationMessage(issueCode: IngredientValidationIssue): string {
  switch (issueCode) {
    case 'missing-item': return 'Missing ingredient name'
    case 'unit-without-amount': return 'Unit specified without amount'
    case 'amount-without-unit': return 'Amount specified without unit'
    default: return 'Validation issue'
  }
}

// ─── SortableIngredientRow ────────────────────────────────────────────────────

function SortableIngredientRow({
  ingredient,
  index,
  onRemoveIngredient,
  onIngredientChange,
  ingredients,
  isEditing,
  editModeLayout,
  editModeTwoColLayout,
  addRecipeModalLayout,
  isWideViewport,
  onBulkPasteIngredients,
  duplicateWarnings,
}: {
  ingredient: Ingredient
  index: number
  onRemoveIngredient: (index: number) => void
  onIngredientChange: (index: number, field: keyof Ingredient, value: string | number | null) => void
  onBulkPasteIngredients: (index: number, text: string) => void
  ingredients: Ingredient[]
  isEditing: boolean
  editModeLayout?: boolean
  editModeTwoColLayout?: boolean
  addRecipeModalLayout?: boolean
  isWideViewport?: boolean
  duplicateWarnings?: string[]
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index.toString() })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [amountStr, setAmountStr] = useState(() =>
    ingredient.amount != null ? toFraction(ingredient.amount) : ""
  )
  useEffect(() => {
    setAmountStr(ingredient.amount != null ? toFraction(ingredient.amount) : "")
  }, [ingredient.amount])

  const [showCustomUnit, setShowCustomUnit] = useState(
    () => !!ingredient.unit && !COMMON_UNITS.includes(ingredient.unit)
  )

  const issues = validateIngredient(ingredient)
  const hasIssues = issues.length > 0
  const issueMessages = issues.map(getValidationMessage)
  const rowWarnings = [...issueMessages, ...(duplicateWarnings || [])]
  const hasRowWarnings = rowWarnings.length > 0
  const stackedGroupBadge = ingredient.groupLabel ? (
    <div className="pl-6 sm:pl-9">
      <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600 dark:bg-zinc-800 dark:text-stone-300">
        {ingredient.groupLabel}
      </span>
    </div>
  ) : null
  const gridGroupBadge = ingredient.groupLabel ? (
    <div className="col-span-full pl-11">
      <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600 dark:bg-zinc-800 dark:text-stone-300">
        {ingredient.groupLabel}
      </span>
    </div>
  ) : null

  const maybeParseSingleLineIngredient = (rawValue: string) => {
    const parsed = parseIngredientLine(rawValue)
    if (!parsed.item) {
      return
    }

    const looksStructured =
      parsed.amount !== null ||
      !!parsed.unit ||
      !!parsed.modifier ||
      normalizeForComparison(parsed.item) !== normalizeForComparison(rawValue)

    if (!looksStructured) {
      return
    }

    if (ingredient.amount !== null || ingredient.unit.trim() || ingredient.modifier?.trim()) {
      return
    }

    onIngredientChange(index, "amount", parsed.amount)
    onIngredientChange(index, "unit", parsed.unit || "")
    onIngredientChange(index, "item", parsed.item)
    onIngredientChange(index, "modifier", parsed.modifier || null)
  }

  const compactInput = editModeTwoColLayout
  const addRecipeInput = addRecipeModalLayout
  const dragHandle = isEditing || addRecipeModalLayout ? (
    <button
      type="button"
      className={cn(
        "touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex-shrink-0",
        editModeLayout ? "flex items-center justify-center w-full h-9" :
        editModeTwoColLayout ? "flex items-center justify-center" :
        addRecipeModalLayout ? "flex items-center justify-center text-lg" :
        "p-1 -ml-1",
        !isWideViewport && "min-h-[44px] min-w-[44px]"
      )}
      aria-label={`Reorder ingredient ${index + 1}: ${ingredient.item || 'unnamed'}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null

  const amountInput = (
    <Input
      className={cn(
        editModeLayout ? "w-full min-w-0 text-sm py-2.5 px-2 text-center rounded-xl border-stone-200 dark:border-zinc-700 bg-muted/50 dark:bg-zinc-900/50" : compactInput ? "w-16 text-center text-sm py-2 rounded-lg bg-background border-stone-200 dark:border-zinc-800" : addRecipeInput ? "w-full min-w-0 text-sm py-1 rounded-lg text-center bg-stone-50 dark:bg-zinc-800/50 border-none focus-visible:ring-0" : "w-20",
        issues.includes('unit-without-amount') && "border-amber-400 dark:border-amber-500"
      )}
      type="text"
      inputMode="decimal"
      placeholder="Amt"
      value={amountStr}
      onChange={(e) => setAmountStr(e.target.value)}
      onBlur={() => {
        const parsed = parseAmountStr(amountStr)
        onIngredientChange(index, "amount", parsed)
        setAmountStr(parsed != null ? toFraction(parsed) : "")
      }}
    />
  )
  const unitInputClass = cn(
    editModeLayout ? "w-full min-w-0 text-sm py-2.5 px-2 rounded-xl border-stone-200 dark:border-zinc-700 bg-muted/50 dark:bg-zinc-900/50" : compactInput ? "w-24 text-sm py-2 px-3 rounded-lg bg-background border-stone-200 dark:border-zinc-800" : addRecipeInput ? "w-full min-w-0 text-sm py-1 px-2 rounded-lg bg-stone-50 dark:bg-zinc-800/50 border-none" : "w-24 border-input",
    issues.includes('amount-without-unit') && "border-amber-400 dark:border-amber-500"
  )
  const unitInput = showCustomUnit ? (
    <Input
      className={unitInputClass}
      placeholder="Unit"
      value={ingredient.unit}
      onChange={(e) => onIngredientChange(index, "unit", e.target.value)}
      autoFocus
    />
  ) : (
    <select
      className={cn("cursor-pointer bg-transparent text-foreground", unitInputClass)}
      value={ingredient.unit || ""}
      onChange={(e) => {
        if (e.target.value === "__custom__") {
          setShowCustomUnit(true)
          onIngredientChange(index, "unit", "")
        } else {
          onIngredientChange(index, "unit", e.target.value)
        }
      }}
    >
      <option value="">—</option>
      {COMMON_UNITS.map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
      <option value="__custom__">Other…</option>
    </select>
  )
  const itemInput = (
    <Input
      className={cn(
        editModeLayout ? "w-full min-w-0 text-sm py-2.5 px-3 rounded-xl border-stone-200 dark:border-zinc-700 bg-muted/50 dark:bg-zinc-900/50" : compactInput ? "flex-1 min-w-0 text-sm py-2 px-3 rounded-lg bg-background border-stone-200 dark:border-zinc-800" : addRecipeInput ? "flex-1 min-w-0 text-sm py-1 px-1 bg-transparent border-none focus-visible:ring-0 placeholder:text-stone-400" : "flex-1",
        issues.includes('missing-item') && "border-amber-400 dark:border-amber-500"
      )}
      placeholder="Ingredient"
      value={ingredient.item}
      onChange={(e) => onIngredientChange(index, "item", e.target.value)}
      onBlur={(e) => maybeParseSingleLineIngredient(e.target.value)}
      onPaste={(e) => {
        const pastedText = e.clipboardData.getData("text")
        if (!pastedText.includes("\n")) return
        e.preventDefault()
        onBulkPasteIngredients(index, pastedText)
      }}
    />
  )
  const modifierInput = (
    <Input
      className={editModeLayout ? "w-full min-w-0 text-sm py-2.5 px-3 rounded-xl border-stone-200 dark:border-zinc-700 bg-muted/50 dark:bg-zinc-900/50" : compactInput ? "w-24 min-w-0 text-sm py-2 px-3 rounded-lg bg-background border-stone-200 dark:border-zinc-800 flex-shrink-0" : addRecipeInput ? "flex-1 min-w-0 text-sm py-1 px-1 bg-transparent border-none focus-visible:ring-0 placeholder:text-stone-400" : "w-32"}
      placeholder="prep (e.g. diced)"
      value={ingredient.modifier || ""}
      onChange={(e) => onIngredientChange(index, "modifier", e.target.value || null)}
    />
  )
  const deleteButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => onRemoveIngredient(index)}
      disabled={ingredients.length === 1}
      className={editModeLayout ? "text-muted-foreground hover:text-destructive flex items-center justify-center h-9 w-9 rounded-lg" : editModeTwoColLayout ? "text-muted-foreground hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0" : addRecipeModalLayout ? cn("text-muted-foreground hover:text-destructive transition-opacity flex-shrink-0 text-lg p-0", isWideViewport ? "opacity-0 group-hover:opacity-100" : "opacity-100") : ""}
      aria-label={`Delete ingredient ${index + 1}: ${ingredient.item || 'unnamed'}`}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  )

  if (addRecipeModalLayout) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        data-has-issues={hasRowWarnings ? "true" : undefined}
        className={cn(
          "bg-background dark:bg-zinc-900 border border-stone-100 dark:border-zinc-800 p-1.5 rounded-xl group relative",
          isDragging && "z-50",
          hasRowWarnings && "ring-2 ring-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20"
        )}
      >
        {hasRowWarnings && (
          <div
            className="absolute -top-2 -right-2 z-10"
            title={rowWarnings.join(', ')}
          >
            <div className="bg-amber-500 text-white rounded-full p-1 shadow-sm">
              <AlertCircle className="h-3.5 w-3.5" />
            </div>
          </div>
        )}
        {stackedGroupBadge}
        {isWideViewport ? (
          <div className="grid grid-cols-[24px_1fr_60px_80px_1fr_32px] gap-3 items-center">
            {dragHandle}
            {itemInput}
            {amountInput}
            {unitInput}
            {modifierInput}
            {deleteButton}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {dragHandle}
              <div className="flex-1 min-w-0">{itemInput}</div>
              {deleteButton}
            </div>
            <div className="flex items-center gap-2 pl-6">
              {amountInput}
              {unitInput}
              {modifierInput}
            </div>
          </div>
        )}
        {rowWarnings.length > 0 ? (
          <p className="px-2 pt-1 text-[11px] text-amber-700 dark:text-amber-400">
            {rowWarnings.join(" • ")}
          </p>
        ) : null}
      </div>
    )
  }

  if (editModeTwoColLayout) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        data-has-issues={hasRowWarnings ? "true" : undefined}
        className={`flex flex-col gap-2 sm:flex-row sm:items-center group ${isDragging ? "z-50" : ""}`}
      >
        {stackedGroupBadge}
        <div className="flex items-center gap-2 sm:flex-[3]">
          {dragHandle}
          <div className="flex-1 min-w-0">
            {itemInput}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-6 sm:pl-0 sm:flex-[2]">
          {amountInput}
          {unitInput}
          {modifierInput}
          {deleteButton}
        </div>
        {rowWarnings.length > 0 ? (
          <p className="pl-6 text-[11px] text-amber-700 dark:text-amber-400 sm:basis-full sm:pl-9">
            {rowWarnings.join(" • ")}
          </p>
        ) : null}
      </div>
    )
  }

  if (editModeLayout) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        data-has-issues={hasRowWarnings ? "true" : undefined}
        className={`grid grid-cols-[32px_2fr_0.8fr_1fr_1.5fr_32px] gap-3 items-center group px-1 ${isDragging ? "z-50" : ""}`}
      >
        {gridGroupBadge}
        {dragHandle}
        {itemInput}
        {amountInput}
        {unitInput}
        {modifierInput}
        {deleteButton}
        {rowWarnings.length > 0 ? (
          <p className="col-span-full pl-11 text-[11px] text-amber-700 dark:text-amber-400">
            {rowWarnings.join(" • ")}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-has-issues={hasRowWarnings ? "true" : undefined}
      className={`flex gap-2 items-center ${isDragging ? "z-50" : ""}`}
    >
      {dragHandle}
      {itemInput}
      {amountInput}
      {unitInput}
      {modifierInput}
      {deleteButton}
      {rowWarnings.length > 0 ? (
        <p className="basis-full pl-6 text-[11px] text-amber-700 dark:text-amber-400">
          {rowWarnings.join(" • ")}
        </p>
      ) : null}
    </div>
  )
}

// ─── IngredientDragOverlay ────────────────────────────────────────────────────

function IngredientDragOverlay({ ingredient }: { ingredient: Ingredient }) {
  return (
    <div className="flex gap-2 items-center bg-card border rounded-lg p-2 shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm">
        {ingredient.amount && ingredient.unit
          ? `${ingredient.amount} ${ingredient.unit} ${ingredient.item}${ingredient.modifier ? `, ${ingredient.modifier}` : ""}`
          : `${ingredient.item || "Ingredient"}${ingredient.modifier ? `, ${ingredient.modifier}` : ""}`}
      </span>
    </div>
  )
}

// ─── SortableIngredientList (public export) ───────────────────────────────────

export interface SortableIngredientListProps {
  ingredients: Ingredient[]
  /** true = edit-recipe layout; false = add-recipe modal layout */
  editModeTwoColLayout?: boolean
  addRecipeModalLayout?: boolean
  isWideViewport?: boolean
  onReorderIngredients: (event: DragEndEvent) => void
  onRemoveIngredient: (index: number) => void
  onIngredientChange: (index: number, field: keyof Ingredient, value: string | number | null) => void
  onBulkPasteIngredients: (index: number, text: string) => void
  duplicateWarningsByRow?: Record<number, string[]>
}

export function SortableIngredientList({
  ingredients,
  editModeTwoColLayout,
  addRecipeModalLayout,
  isWideViewport,
  onReorderIngredients,
  onRemoveIngredient,
  onIngredientChange,
  onBulkPasteIngredients,
  duplicateWarningsByRow,
}: SortableIngredientListProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    onReorderIngredients(event)
  }

  const activeIngredient = activeId ? ingredients[parseInt(activeId)] : null
  const ingredientIds = ingredients.map((_, i) => i.toString())

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ingredientIds} strategy={verticalListSortingStrategy}>
        {addRecipeModalLayout ? (
          <div className="space-y-2">
            {isWideViewport && (
              <div className="grid grid-cols-[24px_1fr_60px_80px_1fr_32px] gap-3 px-2 text-[9px] font-bold uppercase text-stone-400 dark:text-stone-500">
                <span aria-hidden="true" />
                <span>Ingredient</span>
                <span>Amt</span>
                <span>Unit</span>
                <span>Modifier</span>
                <span aria-hidden="true" />
              </div>
            )}
            {ingredients.map((ingredient, index) => (
              <SortableIngredientRow
                key={index}
                ingredient={ingredient}
                index={index}
                onRemoveIngredient={onRemoveIngredient}
                onIngredientChange={onIngredientChange}
                onBulkPasteIngredients={onBulkPasteIngredients}
                duplicateWarnings={duplicateWarningsByRow?.[index]}
                ingredients={ingredients}
                isEditing={true}
                addRecipeModalLayout
                isWideViewport={isWideViewport}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-h-[280px] sm:max-h-[350px] overflow-y-auto pr-2 scrollbar-recipe-dialog">
            {ingredients.map((ingredient, index) => (
              <SortableIngredientRow
                key={index}
                ingredient={ingredient}
                index={index}
                onRemoveIngredient={onRemoveIngredient}
                onIngredientChange={onIngredientChange}
                onBulkPasteIngredients={onBulkPasteIngredients}
                duplicateWarnings={duplicateWarningsByRow?.[index]}
                ingredients={ingredients}
                isEditing={true}
                editModeTwoColLayout
              />
            ))}
          </div>
        )}
      </SortableContext>
      <DragOverlay>
        {activeIngredient ? <IngredientDragOverlay ingredient={activeIngredient} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}
