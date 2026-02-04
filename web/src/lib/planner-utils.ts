export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Parse a date string into a local calendar date (midnight local time).
 * Supports YYYY-MM-DD or full ISO strings with time.
 */
export function parseLocalCalendarDate(dateStr: string): Date | null {
  if (!dateStr) return null

  const ymdMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
  if (ymdMatch) {
    return parseLocalDate(dateStr)
  }

  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Store a date as local noon to avoid UTC boundary shifts when serialized.
 */
export function toLocalNoonISOString(date: Date): string {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

export function dayIndexToDayOfWeek(dayIndex: number, weekStartDay: number): number {
  return (weekStartDay + dayIndex) % 7
}

export function dayOfWeekToDayIndex(dayOfWeek: number, weekStartDay: number): number {
  return (dayOfWeek - weekStartDay + 7) % 7
}

/**
 * Stable hash function for distributing recipes to days.
 * Uses recipe ID to produce a consistent day index.
 */
export function stableRecipeHash(recipeId: string): number {
  let hash = 0
  for (let i = 0; i < recipeId.length; i++) {
    const char = recipeId.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

export function buildUnassignedDayPriority(
  excludedDays: number[] = [],
  preferredDays: number[] | null = null
): number[] {
  const allDays = [0, 1, 2, 3, 4, 5, 6]
  const availableDays = allDays.filter((day) => !excludedDays.includes(day))
  const safeAvailable = availableDays.length > 0 ? availableDays : allDays

  if (preferredDays && preferredDays.length > 0) {
    const availablePreferred = preferredDays.filter((day) => safeAvailable.includes(day))
    const otherAvailable = safeAvailable.filter((day) => !availablePreferred.includes(day))
    return [...availablePreferred, ...otherAvailable]
  }

  return safeAvailable
}

export function getUnassignedDayOfWeek(recipeId: string, dayPriority: number[]): number {
  const bucketCount = dayPriority.length || 7
  const bucketIndex = stableRecipeHash(recipeId) % bucketCount
  return dayPriority[bucketIndex] ?? bucketIndex
}
