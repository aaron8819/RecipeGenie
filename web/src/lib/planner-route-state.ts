import { isCanonicalLocalDate } from "@/lib/planner-utils"

export function parsePlannerWeekParam(
  value: string | string[] | undefined
): string | null {
  const week = Array.isArray(value) ? value[0] : value
  return isCanonicalLocalDate(week) ? week : null
}

export function buildPlannerHref(week: string, defaultWeek: string): string {
  if (!isCanonicalLocalDate(week) || week === defaultWeek) return "/planner"
  return `/planner?week=${encodeURIComponent(week)}`
}
