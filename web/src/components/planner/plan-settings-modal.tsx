"use client"

import { useEffect, useMemo, useState } from "react"
import { Settings } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { getCategoryHexColor } from "@/lib/planner-colors"
import type { UserConfig } from "@/types/database"

interface PlanSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: UserConfig | null
  currentSelection: Record<string, number>
  categories: string[]
  onUpdateConfig: (updates: Partial<UserConfig>) => Promise<void>
  onLoadDefault: () => void
  isUpdating: boolean
}

function SettingsSection({
  title,
  description,
  eyebrow,
  children,
  className,
}: {
  title: string
  description?: string
  eyebrow?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "space-y-4 rounded-2xl border border-stone-200/80 bg-white/70 p-4 shadow-sm sm:p-5",
        className
      )}
    >
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/55">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function CategoryStepper({
  category,
  count,
  onIncrement,
  onDecrement,
}: {
  category: string
  count: number
  onIncrement: () => void
  onDecrement: () => void
}) {
  const categoryColor = getCategoryHexColor(category)
  const isActive = count > 0

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-all",
        isActive
          ? "border-stone-300 bg-white shadow-sm"
          : "border-stone-200/90 bg-stone-50/80"
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <span className="truncate text-sm font-medium capitalize">{category}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDecrement}
          disabled={count === 0}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-lg leading-none transition-colors hover:bg-stone-100 disabled:opacity-30"
          aria-label={`Decrease ${category} count`}
        >
          <span aria-hidden="true">-</span>
        </button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums text-foreground">
          {count}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          disabled={count === 5}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-lg leading-none transition-colors hover:bg-stone-100 disabled:opacity-30"
          aria-label={`Increase ${category} count`}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  )
}

function DayToggleGrid({
  label,
  helperText,
  days,
  selectedDays,
  disabledDays,
  selectedClassName,
  idleClassName,
  disabledClassName,
  onToggle,
}: {
  label: string
  helperText?: string
  days: string[]
  selectedDays: number[]
  disabledDays?: number[]
  selectedClassName: string
  idleClassName: string
  disabledClassName?: string
  onToggle: (dayIndex: number) => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/60">
          {label}
        </Label>
        {helperText ? <p className="text-xs leading-5 text-muted-foreground">{helperText}</p> : null}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((dayLabel, dayIndex) => {
          const isSelected = selectedDays.includes(dayIndex)
          const isDisabled = disabledDays?.includes(dayIndex) ?? false

          return (
            <label
              key={dayIndex}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center transition-colors",
                isDisabled
                  ? disabledClassName || "cursor-not-allowed border-stone-200 bg-stone-100 opacity-50"
                  : isSelected
                    ? selectedClassName
                    : idleClassName
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggle(dayIndex)}
                disabled={isDisabled}
                className="mb-0.5"
              />
              <span className="text-[11px] font-semibold">{dayLabel}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function CoreDefaultsSection({
  categories,
  defaultSelection,
  setDefaultSelection,
  totalDefaultMeals,
  onLoadDefault,
  onSaveDefault,
  isUpdating,
  selectionMatchesDefault,
}: {
  categories: string[]
  defaultSelection: Record<string, number>
  setDefaultSelection: React.Dispatch<React.SetStateAction<Record<string, number>>>
  totalDefaultMeals: number
  onLoadDefault: () => void
  onSaveDefault: () => void
  isUpdating: boolean
  selectionMatchesDefault: boolean
}) {
  return (
    <SettingsSection
      eyebrow="Core Defaults"
      title="Default Category Breakdown"
      description="Set the meal mix planner generation starts from. These defaults stay separate from the current week until you choose to apply or save them."
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-stone-50/80 px-3 py-2.5">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{totalDefaultMeals}</span> meals in default mix
        </p>
        <span className="rounded-full bg-primary/8 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/70">
          Primary
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {categories.map((category) => (
          <CategoryStepper
            key={category}
            category={category}
            count={defaultSelection[category] || 0}
            onIncrement={() => {
              setDefaultSelection((prev) => ({
                ...prev,
                [category]: Math.min(5, (prev[category] || 0) + 1),
              }))
            }}
            onDecrement={() => {
              setDefaultSelection((prev) => ({
                ...prev,
                [category]: Math.max(0, (prev[category] || 0) - 1),
              }))
            }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-stone-200/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">
          Local actions for your saved default. Use them here without affecting the modal-wide save buttons below.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadDefault}
            disabled={isUpdating || selectionMatchesDefault}
            className="justify-center border-stone-200 bg-white/90 text-slate-700 hover:bg-stone-100"
          >
            Load Saved Default
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDefault}
            disabled={isUpdating}
            className="justify-center border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
          >
            Save as Default
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}

function SchedulingRulesSection({
  dayAbbrevs,
  excludedDays,
  preferredDays,
  autoAssignDays,
  availableDays,
  totalDefaultMeals,
  onToggleExcludedDay,
  onTogglePreferredDay,
  onSetAutoAssignDays,
}: {
  dayAbbrevs: string[]
  excludedDays: number[]
  preferredDays: number[] | null
  autoAssignDays: boolean
  availableDays: number
  totalDefaultMeals: number
  onToggleExcludedDay: (dayIndex: number) => void
  onTogglePreferredDay: (dayIndex: number) => void
  onSetAutoAssignDays: (nextValue: boolean) => void
}) {
  return (
    <SettingsSection
      eyebrow="Scheduling Rules"
      title="Day Placement Rules"
      description="Control when planner can place meals. Auto-assign handles the main behavior, while excluded and preferred days fine-tune the schedule."
    >
      <div className="rounded-xl border border-stone-200/80 bg-stone-50/80 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-foreground">Auto-assign days</Label>
            <p className="text-xs leading-5 text-muted-foreground">
              Automatically place generated meals onto available days.
            </p>
          </div>
          <Checkbox
            checked={autoAssignDays}
            onCheckedChange={(checked) => onSetAutoAssignDays(checked === true)}
          />
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-stone-200/80 bg-white/85 p-3.5">
        <DayToggleGrid
          label="Excluded Days"
          helperText="Meals will avoid these days entirely."
          days={dayAbbrevs}
          selectedDays={excludedDays}
          selectedClassName="border-red-200 bg-red-50"
          idleClassName="border-sage-200 bg-sage-50 hover:bg-sage-100"
          onToggle={onToggleExcludedDay}
        />

        <DayToggleGrid
          label="Preferred Days"
          helperText="Optional priorities used when auto-assignment has multiple valid choices."
          days={dayAbbrevs}
          selectedDays={preferredDays || []}
          disabledDays={excludedDays}
          selectedClassName="border-blue-200 bg-blue-50"
          idleClassName="border-sage-200 bg-sage-50 hover:bg-sage-100"
          disabledClassName="cursor-not-allowed border-stone-200 bg-stone-100 opacity-50"
          onToggle={onTogglePreferredDay}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>{availableDays} day{availableDays !== 1 ? "s" : ""} available for planning</span>
        {excludedDays.length > 0 ? (
          <span>{excludedDays.length} excluded</span>
        ) : null}
        {preferredDays && preferredDays.length > 0 ? (
          <span>{preferredDays.length} preferred</span>
        ) : null}
      </div>

      {totalDefaultMeals > availableDays ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2.5">
          <p className="text-xs leading-5 text-yellow-800">
            <strong>Warning:</strong> Your default selection has {totalDefaultMeals} meals but only {availableDays} day{availableDays !== 1 ? "s are" : " is"} available. Some meals may not be assigned to days.
          </p>
        </div>
      ) : null}

      {availableDays === 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-xs leading-5 text-red-800">
            <strong>Error:</strong> All days are excluded. Please enable at least one day.
          </p>
        </div>
      ) : null}
    </SettingsSection>
  )
}

function AdvancedSettingsSection({
  historyExclusionDays,
  onSetHistoryExclusionDays,
  categories,
  enabledPlannerCategories,
  onSetEnabledPlannerCategories,
}: {
  historyExclusionDays: number
  onSetHistoryExclusionDays: (nextValue: number) => void
  categories: string[]
  enabledPlannerCategories: string[] | null
  onSetEnabledPlannerCategories: React.Dispatch<React.SetStateAction<string[] | null>>
}) {
  return (
    <SettingsSection
      eyebrow="Advanced"
      title="Library And Planner Controls"
      description="Lower-priority tuning for recipe reuse and which categories appear in Quick Meal Mix."
      className="bg-stone-50/80"
    >
      <div className="space-y-3 rounded-xl border border-stone-200/80 bg-white/90 p-3.5">
        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/60">
            History Exclusion
          </Label>
          <p className="text-xs leading-5 text-muted-foreground">
            Exclude recently made recipes from new plan generation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="history-days" className="text-sm whitespace-nowrap text-foreground">
            Last
          </Label>
          <Input
            id="history-days"
            type="number"
            min="0"
            max="365"
            value={historyExclusionDays}
            onChange={(e) => onSetHistoryExclusionDays(parseInt(e.target.value) || 0)}
            className="h-10 w-24"
          />
          <Label className="text-sm whitespace-nowrap text-foreground">days</Label>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-stone-200/80 bg-white/90 p-3.5">
        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/60">
            Planner Categories
          </Label>
          <p className="text-xs leading-5 text-muted-foreground">
            Choose which categories appear in Quick Meal Mix. Disabled categories remain available in your recipe library.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.map((category) => {
            const isEnabled =
              enabledPlannerCategories === null ||
              enabledPlannerCategories.includes(category)
            const categoryColor = getCategoryHexColor(category)

            return (
              <label
                key={category}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors",
                  isEnabled
                    ? "border-sage-200 bg-sage-50 hover:bg-sage-100"
                    : "border-stone-200 bg-stone-50 hover:bg-stone-100"
                )}
              >
                <Checkbox
                  checked={isEnabled}
                  onCheckedChange={(checked) => {
                    onSetEnabledPlannerCategories((prev) => {
                      const current = prev === null ? [...categories] : prev

                      if (checked) {
                        return current.includes(category) ? current : [...current, category]
                      }

                      const updated = current.filter((c) => c !== category)
                      return updated.length === categories.length ? null : updated
                    })
                  }}
                />
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor }}
                  />
                  <span className="truncate text-sm font-medium capitalize">{category}</span>
                </div>
              </label>
            )
          })}
        </div>

        {enabledPlannerCategories !== null && enabledPlannerCategories.length === 0 ? (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2.5">
            <p className="text-xs leading-5 text-yellow-800">
              <strong>Warning:</strong> No categories enabled. You will need at least one category enabled to generate meal plans.
            </p>
          </div>
        ) : null}

        {enabledPlannerCategories !== null ? (
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {enabledPlannerCategories.length} of {categories.length} categories enabled
            </span>
            <button
              type="button"
              onClick={() => onSetEnabledPlannerCategories(null)}
              className="font-medium text-primary hover:underline"
            >
              Enable All
            </button>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}

export function PlanSettingsModal({
  open,
  onOpenChange,
  config,
  currentSelection,
  categories,
  onUpdateConfig,
  onLoadDefault,
  isUpdating,
}: PlanSettingsModalProps) {
  const [defaultSelection, setDefaultSelection] = useState<Record<string, number>>(
    config?.default_selection || {}
  )
  const [excludedDays, setExcludedDays] = useState<number[]>(
    config?.excluded_days || []
  )
  const [preferredDays, setPreferredDays] = useState<number[] | null>(
    config?.preferred_days || null
  )
  const [autoAssignDays, setAutoAssignDays] = useState<boolean>(
    config?.auto_assign_days ?? true
  )
  const [historyExclusionDays, setHistoryExclusionDays] = useState<number>(
    config?.history_exclusion_days || 7
  )
  const [enabledPlannerCategories, setEnabledPlannerCategories] = useState<string[] | null>(
    config?.enabled_planner_categories || null
  )

  useEffect(() => {
    if (config) {
      setDefaultSelection(config.default_selection || {})
      setExcludedDays(config.excluded_days || [])
      setPreferredDays(config.preferred_days || null)
      setAutoAssignDays(config.auto_assign_days ?? true)
      setHistoryExclusionDays(config.history_exclusion_days || 7)
      setEnabledPlannerCategories(config.enabled_planner_categories || null)
    }
  }, [config])

  const dayAbbrevs = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const totalDefaultMeals = Object.values(defaultSelection).reduce((sum, n) => sum + n, 0)
  const availableDays = 7 - excludedDays.length

  const handleSaveDefault = async () => {
    try {
      await onUpdateConfig({ default_selection: defaultSelection })
    } catch (error) {
      console.error("Failed to save default selection:", error)
    }
  }

  const handleSaveAll = async () => {
    try {
      await onUpdateConfig({
        default_selection: defaultSelection,
        excluded_days: excludedDays,
        preferred_days: preferredDays,
        auto_assign_days: autoAssignDays,
        history_exclusion_days: historyExclusionDays,
        enabled_planner_categories: enabledPlannerCategories,
      })
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save settings:", error)
    }
  }

  const toggleExcludedDay = (dayIndex: number) => {
    setExcludedDays((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((d) => d !== dayIndex)
        : [...prev, dayIndex].sort()
    )
  }

  const togglePreferredDay = (dayIndex: number) => {
    setPreferredDays((prev) => {
      if (!prev) return [dayIndex]
      if (prev.includes(dayIndex)) {
        const updated = prev.filter((d) => d !== dayIndex)
        return updated.length > 0 ? updated : null
      }
      return [...prev, dayIndex].sort()
    })
  }

  const selectionMatchesDefault = useMemo(() => {
    const currentKeys = Object.keys(currentSelection).sort()
    const defaultKeys = Object.keys(defaultSelection).sort()
    if (currentKeys.length !== defaultKeys.length) return false
    return currentKeys.every((key) => currentSelection[key] === defaultSelection[key])
  }, [currentSelection, defaultSelection])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-stone-200/80 bg-card px-5 py-4 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Plan Settings
            </DialogTitle>
            <p className="pr-10 text-sm text-muted-foreground">
              Configure your default meal mix, scheduling rules, and planner-level category behavior.
            </p>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto bg-gradient-to-b from-stone-50/60 to-background px-4 py-4 sm:px-6 sm:py-5">
            <CoreDefaultsSection
              categories={categories}
              defaultSelection={defaultSelection}
              setDefaultSelection={setDefaultSelection}
              totalDefaultMeals={totalDefaultMeals}
              onLoadDefault={onLoadDefault}
              onSaveDefault={() => void handleSaveDefault()}
              isUpdating={isUpdating}
              selectionMatchesDefault={selectionMatchesDefault}
            />

            <SchedulingRulesSection
              dayAbbrevs={dayAbbrevs}
              excludedDays={excludedDays}
              preferredDays={preferredDays}
              autoAssignDays={autoAssignDays}
              availableDays={availableDays}
              totalDefaultMeals={totalDefaultMeals}
              onToggleExcludedDay={toggleExcludedDay}
              onTogglePreferredDay={togglePreferredDay}
              onSetAutoAssignDays={setAutoAssignDays}
            />

            <AdvancedSettingsSection
              historyExclusionDays={historyExclusionDays}
              onSetHistoryExclusionDays={setHistoryExclusionDays}
              categories={categories}
              enabledPlannerCategories={enabledPlannerCategories}
              onSetEnabledPlannerCategories={setEnabledPlannerCategories}
            />
          </div>

          <div className="safe-area-bottom sticky bottom-0 border-t border-stone-200/80 bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-stone-200 bg-white/90"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveAll}
                disabled={isUpdating || availableDays === 0}
                className="bg-sage-600 hover:bg-sage-700"
              >
                Save Settings
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
