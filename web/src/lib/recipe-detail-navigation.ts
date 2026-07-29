import { type HomeTab } from "@/app/home-tab-state"
import { persistHomeTab } from "@/lib/home-navigation"

const ORIGIN_STORAGE_PREFIX = "recipe-genie:recipe-detail-origin:v1:"
const ORIGIN_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type RecipeDetailSource = "recipes" | "planner" | "shopping"

interface RecipeDetailOrigin {
  createdAt: number
  recipeId: string
  source: RecipeDetailSource
}

interface RecipeDetailRouter {
  back: () => void
  push: (href: string, options?: { scroll?: boolean }) => void
  replace: (href: string) => void
}

export function normalizeRecipeDetailSource(
  source: string | undefined
): RecipeDetailSource | null {
  return source === "recipes" ||
    source === "planner" ||
    source === "shopping"
    ? source
    : null
}

export function buildRecipeDetailHref(
  recipeId: string,
  source?: RecipeDetailSource,
  originToken?: string
): string {
  const params = new URLSearchParams()
  if (source) params.set("from", source)
  if (originToken) params.set("origin", originToken)

  const query = params.toString()
  return `/recipes/${encodeURIComponent(recipeId)}${query ? `?${query}` : ""}`
}

function parseCreatedAt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== "string" || !value.trim()) return null

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function readOrigin(originToken: string | null): RecipeDetailOrigin | null {
  if (!originToken || typeof window === "undefined") return null

  const key = `${ORIGIN_STORAGE_PREFIX}${originToken}`

  try {
    const stored = window.sessionStorage.getItem(key)
    if (!stored) return null

    const origin = JSON.parse(stored) as Partial<RecipeDetailOrigin> | null
    const createdAt = parseCreatedAt(origin?.createdAt)
    const age = createdAt == null ? Number.NaN : Date.now() - createdAt
    const source = normalizeRecipeDetailSource(origin?.source)

    if (
      createdAt == null ||
      age < 0 ||
      age > ORIGIN_MAX_AGE_MS ||
      typeof origin?.recipeId !== "string" ||
      origin.recipeId.length === 0 ||
      source == null
    ) {
      window.sessionStorage.removeItem(key)
      return null
    }

    return {
      createdAt,
      recipeId: origin.recipeId,
      source,
    }
  } catch {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // Storage can be disabled; the safe home fallback remains available.
    }
    return null
  }
}

export function getRecipeDetailReturnSource(
  recipeId: string,
  originToken: string | null
): RecipeDetailSource | null {
  const origin = readOrigin(originToken)
  return origin?.recipeId === recipeId ? origin.source : null
}

function safelyPersistHomeTab(source: HomeTab) {
  try {
    persistHomeTab(source)
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
}

export function openRecipeDetail(
  router: RecipeDetailRouter,
  recipeId: string,
  source: RecipeDetailSource
) {
  safelyPersistHomeTab(source)

  const originToken = crypto.randomUUID()
  const origin: RecipeDetailOrigin = {
    createdAt: Date.now(),
    recipeId,
    source,
  }

  let storedOriginToken: string | undefined
  try {
    window.sessionStorage.setItem(
      `${ORIGIN_STORAGE_PREFIX}${originToken}`,
      JSON.stringify(origin)
    )
    storedOriginToken = originToken
  } catch {
    // The safe Recipes fallback remains available without stored context.
  }

  router.push(buildRecipeDetailHref(recipeId, source, storedOriginToken), {
    scroll: false,
  })
}

export function returnFromRecipeDetail(
  router: RecipeDetailRouter,
  recipeId: string,
  originToken: string | null
) {
  const source = getRecipeDetailReturnSource(recipeId, originToken)

  if (source) {
    router.back()
    return
  }

  safelyPersistHomeTab("recipes")
  router.replace("/")
}
