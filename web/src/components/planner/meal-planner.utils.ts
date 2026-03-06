import { parseLocalCalendarDate, parseLocalDate } from "@/lib/planner-utils"

export type MobileWeekTab = "today" | "thisWeek" | "nextWeek"

export type PlannerWeekDay = {
  date: Date
  dayName: string
  dayNumber: number
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function getWeekStartDate(date: Date, weekStartDay: number = 1): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day < weekStartDay ? 7 : 0) + day - weekStartDay
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return toLocalDateString(d)
}

export function navigateWeek(currentWeekDate: string, direction: "prev" | "next"): string {
  const [y, m, day] = currentWeekDate.split("-").map(Number)
  const date = new Date(y, m - 1, day)
  date.setDate(date.getDate() + (direction === "next" ? 7 : -7))
  return toLocalDateString(date)
}

export function getThisAndNextWeekStarts(today: Date, weekStartDay: number): {
  thisWeekStart: string
  nextWeekStart: string
} {
  const thisWeekStart = getWeekStartDate(today, weekStartDay)
  return {
    thisWeekStart,
    nextWeekStart: navigateWeek(thisWeekStart, "next"),
  }
}

export function resolveEffectiveMobileWeekTab(
  mobileWeekTab: MobileWeekTab,
  currentWeekDate: string,
  weekStartDay: number
): MobileWeekTab | null {
  if (mobileWeekTab === "today") return "today"
  const { thisWeekStart, nextWeekStart } = getThisAndNextWeekStarts(new Date(), weekStartDay)
  if (currentWeekDate === thisWeekStart) return "thisWeek"
  if (currentWeekDate === nextWeekStart) return "nextWeek"
  return null
}

export function resolveWeekDateForMobileTab(tab: MobileWeekTab, weekStartDay: number): string {
  const { thisWeekStart, nextWeekStart } = getThisAndNextWeekStarts(new Date(), weekStartDay)
  if (tab === "nextWeek") return nextWeekStart
  return thisWeekStart
}

export function isDateInWeekRange(dateStr: string, weekStartDate: string): boolean {
  if (!dateStr || !weekStartDate) return false

  const date = parseLocalCalendarDate(dateStr)
  if (!date) return false

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

export function formatLocalISODate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function getWeekDays(weekStartDate: string): PlannerWeekDay[] {
  if (!weekStartDate) return []

  const startDate = parseLocalDate(weekStartDate)
  const days: PlannerWeekDay[] = []
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

export function formatWeekLabel(weekStartDate: string): string {
  if (!weekStartDate) return ""
  const date = parseLocalDate(weekStartDate)
  const endDate = new Date(date)
  endDate.setDate(endDate.getDate() + 6)
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${date.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`
}

export function getDayOfWeekForWeekIndex(weekDays: PlannerWeekDay[], dayIndex: number): number {
  const day = weekDays[dayIndex]
  return day ? day.date.getDay() : dayIndex
}

export function getWeekDayIndexForDate(weekDays: PlannerWeekDay[], date: Date): number {
  const key = date.toDateString()
  return weekDays.findIndex((w) => w.date.toDateString() === key)
}
