"use client"

import { useState, useMemo } from "react"
import { Settings, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import type { UserConfig } from "@/types/database"
import { cn } from "@/lib/utils"

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

/**
 * Category pill component for settings modal
 */
function CategoryPill({
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
  const CATEGORY_HEX_COLORS: Record<string, string> = {
    chicken: "#4d7c0f",
    beef: "#b91c1c",
    lamb: "#c2410c",
    turkey: "#a16207",
    vegetarian: "#1d4ed8",
  }

  const categoryColor = CATEGORY_HEX_COLORS[category.toLowerCase()] || "#6b7280"
  const isActive = count > 0

  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all",
        isActive ? "bg-opacity-10" : "border-sage-200 bg-white"
      )}
      style={{
        borderColor: isActive ? categoryColor : undefined,
        backgroundColor: isActive ? `${categoryColor}10` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <span className="text-sm font-medium capitalize whitespace-nowrap">
          {category}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onDecrement}
          disabled={count === 0}
          className="w-7 h-7 rounded-full border border-sage-300 flex items-center justify-center
                     disabled:opacity-30 hover:bg-sage-100 transition-colors"
          aria-label={`Decrease ${category} count`}
        >
          <span className="text-lg leading-none">−</span>
        </button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">
          {count}
        </span>
        <button
          onClick={onIncrement}
          disabled={count === 5}
          className="w-7 h-7 rounded-full border border-sage-300 flex items-center justify-center
                     disabled:opacity-30 hover:bg-sage-100 transition-colors"
          aria-label={`Increase ${category} count`}
        >
          <span className="text-lg leading-none">+</span>
        </button>
      </div>
    </div>
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

  // Initialize from config when it changes
  useMemo(() => {
    if (config) {
      setDefaultSelection(config.default_selection || {})
      setExcludedDays(config.excluded_days || [])
      setPreferredDays(config.preferred_days || null)
      setAutoAssignDays(config.auto_assign_days ?? true)
      setHistoryExclusionDays(config.history_exclusion_days || 7)
    }
  }, [config])

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const dayAbbrevs = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  const totalDefaultMeals = Object.values(defaultSelection).reduce((sum, n) => sum + n, 0)
  const availableDays = 7 - excludedDays.length

  // Save default category breakdown
  const handleSaveDefault = async () => {
    try {
      await onUpdateConfig({ default_selection: defaultSelection })
    } catch (error) {
      console.error("Failed to save default selection:", error)
    }
  }

  // Save all settings
  const handleSaveAll = async () => {
    try {
      await onUpdateConfig({
        default_selection: defaultSelection,
        excluded_days: excludedDays,
        preferred_days: preferredDays,
        auto_assign_days: autoAssignDays,
        history_exclusion_days: historyExclusionDays,
      })
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save settings:", error)
    }
  }

  // Toggle excluded day
  const toggleExcludedDay = (dayIndex: number) => {
    setExcludedDays((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((d) => d !== dayIndex)
        : [...prev, dayIndex].sort()
    )
  }

  // Toggle preferred day
  const togglePreferredDay = (dayIndex: number) => {
    setPreferredDays((prev) => {
      if (!prev) {
        return [dayIndex]
      }
      if (prev.includes(dayIndex)) {
        const updated = prev.filter((d) => d !== dayIndex)
        return updated.length > 0 ? updated : null
      }
      return [...prev, dayIndex].sort()
    })
  }

  // Check if selection matches default
  const selectionMatchesDefault = useMemo(() => {
    const currentKeys = Object.keys(currentSelection).sort()
    const defaultKeys = Object.keys(defaultSelection).sort()
    if (currentKeys.length !== defaultKeys.length) return false
    return currentKeys.every(
      (key) => currentSelection[key] === defaultSelection[key]
    )
  }, [currentSelection, defaultSelection])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Plan Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Default Category Breakdown */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Default Category Breakdown</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Set your preferred meal distribution. This will be used as the default when generating new plans.
              </p>
            </div>

            <div className="flex gap-3 flex-wrap pb-2">
              {categories.map((category) => (
                <CategoryPill
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

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{totalDefaultMeals}</span> meals in default
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoadDefault}
                  disabled={isUpdating || selectionMatchesDefault}
                >
                  Use Current Selection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDefault}
                  disabled={isUpdating}
                >
                  Save as Default
                </Button>
              </div>
            </div>
          </div>

          {/* Day Placement Rules */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Day Placement Rules</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Control which days meals can be placed on. Excluded days will be avoided, preferred days will be prioritized.
              </p>
            </div>

            {/* Excluded Days */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Excluded Days</Label>
              <div className="grid grid-cols-7 gap-2">
                {dayNames.map((dayName, dayIndex) => {
                  const isExcluded = excludedDays.includes(dayIndex)
                  const isPreferred = preferredDays?.includes(dayIndex)
                  return (
                    <label
                      key={dayIndex}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-colors",
                        isExcluded
                          ? "bg-red-50 border-red-200"
                          : "bg-sage-50 border-sage-200 hover:bg-sage-100"
                      )}
                    >
                      <Checkbox
                        checked={isExcluded}
                        onCheckedChange={() => toggleExcludedDay(dayIndex)}
                        className="mb-1"
                      />
                      <span className="text-xs font-medium">{dayAbbrevs[dayIndex]}</span>
                    </label>
                  )
                })}
              </div>
              {excludedDays.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {excludedDays.length} day{excludedDays.length !== 1 ? "s" : ""} excluded. {availableDays} day{availableDays !== 1 ? "s" : ""} available.
                </p>
              )}
            </div>

            {/* Preferred Days */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Preferred Days (Optional)</Label>
              <div className="grid grid-cols-7 gap-2">
                {dayNames.map((dayName, dayIndex) => {
                  const isExcluded = excludedDays.includes(dayIndex)
                  const isPreferred = preferredDays?.includes(dayIndex)
                  return (
                    <label
                      key={dayIndex}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-colors",
                        isExcluded
                          ? "bg-gray-100 border-gray-200 cursor-not-allowed opacity-50"
                          : isPreferred
                            ? "bg-blue-50 border-blue-200"
                            : "bg-sage-50 border-sage-200 hover:bg-sage-100"
                      )}
                    >
                      <Checkbox
                        checked={isPreferred}
                        onCheckedChange={() => togglePreferredDay(dayIndex)}
                        disabled={isExcluded}
                        className="mb-1"
                      />
                      <span className="text-xs font-medium">{dayAbbrevs[dayIndex]}</span>
                    </label>
                  )
                })}
              </div>
              {preferredDays && preferredDays.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preferredDays.length} preferred day{preferredDays.length !== 1 ? "s" : ""} selected.
                </p>
              )}
            </div>

            {/* Auto-assign toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-sage-50">
              <div className="flex-1">
                <Label className="text-sm font-medium">Auto-assign days</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically assign meals to days when generating a plan
                </p>
              </div>
              <Checkbox
                checked={autoAssignDays}
                onCheckedChange={(checked) => setAutoAssignDays(checked === true)}
              />
            </div>
          </div>

          {/* History Exclusion */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">History Exclusion</Label>
            <div className="flex items-center gap-3">
              <Label htmlFor="history-days" className="text-xs text-muted-foreground whitespace-nowrap">
                Exclude recipes made within the last
              </Label>
              <Input
                id="history-days"
                type="number"
                min="0"
                max="365"
                value={historyExclusionDays}
                onChange={(e) => setHistoryExclusionDays(parseInt(e.target.value) || 0)}
                className="w-20"
              />
              <Label className="text-xs text-muted-foreground whitespace-nowrap">days</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Recipes made within this window will be excluded from meal plan generation.
            </p>
          </div>

          {/* Warning if conflicts */}
          {totalDefaultMeals > availableDays && (
            <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50">
              <p className="text-xs text-yellow-800">
                <strong>Warning:</strong> Your default selection has {totalDefaultMeals} meals but only {availableDays} day{availableDays !== 1 ? "s are" : " is"} available. 
                Some meals may not be assigned to days.
              </p>
            </div>
          )}

          {availableDays === 0 && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50">
              <p className="text-xs text-red-800">
                <strong>Error:</strong> All days are excluded. Please enable at least one day.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
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
      </DialogContent>
    </Dialog>
  )
}
