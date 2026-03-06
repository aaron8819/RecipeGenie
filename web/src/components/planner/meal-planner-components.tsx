import React, { type HTMLAttributes, type ReactNode } from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
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
    <div className="space-y-4">
      <div className="bg-card-cream rounded-xl p-4 shadow-sm border border-border-muted">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-sm font-semibold text-primary">{weekLabel}</span>
          {showControls ? controls : null}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-primary/80">Weekly Progress</span>
            <span className="font-bold text-primary">{progressLabel}</span>
          </div>
          <div className="w-full bg-white/80 h-2 rounded-full overflow-hidden border border-border-muted">
            <div
              className="bg-primary h-full transition-all duration-300"
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
    <nav className="flex border-b border-border-muted">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={tab.onClick}
          className={cn(
            "flex-1 py-3 text-xs font-bold border-b-2 transition-colors",
            tab.isActive
              ? "text-primary border-primary"
              : "text-primary/60 border-transparent"
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
    <div className="space-y-4 -mt-3 lg:mt-0">
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
        {leading}
        <div className="flex items-center gap-2 lg:ml-auto shrink-0 overflow-x-auto pb-1 lg:pb-0 scrollbar-thin">
          {children}
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
