import React, { type HTMLAttributes, type ReactNode } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

type PlannerDaySectionProps = {
  as?: "div" | "section"
  header: ReactNode
  headerClassName?: string
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, "children">

export const PlannerDaySection = React.forwardRef<HTMLElement, PlannerDaySectionProps>(
  function PlannerDaySection(
    {
      as = "div",
      className,
      header,
      headerClassName,
      children,
      ...rest
    },
    ref
  ) {
    return React.createElement(
      as,
      {
        ref,
        className,
        ...rest,
      },
      <>
        <div className={headerClassName}>{header}</div>
        {children}
      </>
    )
  }
)

type PlannerSectionShellProps = {
  className?: string
  header?: ReactNode
  headerClassName?: string
  children: ReactNode
}

export function PlannerSectionShell({
  className,
  header,
  headerClassName,
  children,
}: PlannerSectionShellProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-sm border border-stone-100 dark:border-zinc-800",
        className
      )}
    >
      {header ? <div className={headerClassName}>{header}</div> : null}
      {children}
    </div>
  )
}

type PlannerDesktopWeekShellProps = {
  children: ReactNode
  onPrevious: () => void
  onNext: () => void
}

export function PlannerDesktopWeekShell({
  children,
  onPrevious,
  onNext,
}: PlannerDesktopWeekShellProps) {
  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={onPrevious}
        className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
        aria-label="Previous week"
      >
        <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
      </button>
      <div className="flex-1 min-w-0 grid grid-cols-7 gap-4">{children}</div>
      <button
        type="button"
        onClick={onNext}
        className="shrink-0 p-2 rounded-lg bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors mt-1"
        aria-label="Next week"
      >
        <ChevronRight className="h-5 w-5 text-slate-600 dark:text-zinc-300" />
      </button>
    </div>
  )
}

type PlannerMobileHeaderProps = {
  weekLabel: string
  showControls?: boolean
  controls?: ReactNode
  progressLabel: string
  progressValue: number
}

export function PlannerMobileHeader({
  weekLabel,
  showControls = false,
  controls,
  progressLabel,
  progressValue,
}: PlannerMobileHeaderProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border-muted bg-card-cream px-4 py-4 shadow-[0_10px_30px_rgba(72,92,55,0.08)] sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">
              Planner Week
            </span>
            <span className="block text-lg font-semibold leading-tight text-primary sm:text-xl">{weekLabel}</span>
          </div>
          {showControls ? <div className="shrink-0">{controls}</div> : null}
        </div>
        <div className="mt-4 space-y-2 sm:mt-5 sm:space-y-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-sm font-medium text-primary/80">Weekly Progress</span>
            <span className="text-sm font-semibold text-primary">{progressLabel}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-border-muted bg-white/80 sm:h-3">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

type PlannerMobileTabBarProps = {
  tabs: Array<{
    key: string
    label: string
    isActive: boolean
    onClick: () => void
  }>
}

export function PlannerMobileTabBar({ tabs }: PlannerMobileTabBarProps) {
  return (
    <nav className="flex rounded-2xl border border-border-muted/80 bg-stone-50/70 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={tab.onClick}
          className={cn(
            "min-h-11 flex-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition-all sm:px-3",
            tab.isActive
              ? "bg-white text-primary shadow-sm"
              : "text-primary/60"
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

type PlannerActionBarProps = {
  leading?: ReactNode
  children: ReactNode
}

export function PlannerActionBar({ leading, children }: PlannerActionBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {leading}
        <div className="lg:ml-auto">
          <div className="flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-1.5 shadow-sm lg:bg-transparent lg:p-0 lg:shadow-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

type PlannerEmptyWeekPanelProps = {
  children: ReactNode
}

export function PlannerEmptyWeekPanel({ children }: PlannerEmptyWeekPanelProps) {
  return (
    <div className="flex flex-col items-center py-8 px-4">
      <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
        Plan your week
      </h3>
      <p className="text-muted-foreground max-w-sm mb-6 text-center">
        Select how many meals you want for each category, then generate a meal plan.
      </p>
      {children}
    </div>
  )
}

type PlannerDayAddButtonProps = {
  onClick: () => void
  ariaLabel: string
  desktop?: boolean
}

export function PlannerDayAddButton({
  onClick,
  ariaLabel,
  desktop = false,
}: PlannerDayAddButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "w-full border border-dashed transition-colors flex items-center justify-center gap-2 text-slate-500 hover:text-primary dark:hover:text-emerald-400 hover:border-primary dark:hover:border-emerald-500",
        desktop
          ? "rounded-xl border-slate-300 dark:border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide"
          : "rounded-2xl border-slate-200 dark:border-slate-800 px-4 py-3 text-sm font-semibold"
      )}
    >
      <Plus className={cn("shrink-0", desktop ? "h-4 w-4" : "h-4 w-4")} />
      <span>Add Meal</span>
    </button>
  )
}

type PlannerMobileWeekStripProps = {
  days: Array<{
    key: string
    shortLabel: string
    dayNumber: number
    isToday: boolean
    ariaLabel: string
    onSelect: () => void
  }>
}

export function PlannerMobileWeekStrip({ days }: PlannerMobileWeekStripProps) {
  return (
    <div className="flex items-center justify-between overflow-x-auto scrollbar-hide gap-4 py-2">
      {days.map((day) => (
        <div
          key={day.key}
          className="flex flex-col items-center min-w-[50px] relative flex-shrink-0"
        >
          <span
            className={cn(
              "text-[10px] uppercase tracking-widest font-bold",
              day.isToday ? "text-primary dark:text-emerald-400" : "text-slate-400"
            )}
          >
            {day.shortLabel}
          </span>
          <button
            type="button"
            onClick={day.onSelect}
            className={cn(
              "text-lg font-display font-medium transition-colors",
              day.isToday && "font-bold text-primary dark:text-emerald-400",
              !day.isToday && "text-slate-700 dark:text-slate-200 hover:text-primary dark:hover:text-emerald-300"
            )}
            aria-label={day.ariaLabel}
          >
            {day.dayNumber}
          </button>
          {day.isToday ? (
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary dark:bg-emerald-400 rounded-full" />
          ) : null}
        </div>
      ))}
    </div>
  )
}
