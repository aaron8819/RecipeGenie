import type { QueryKey } from "@tanstack/react-query"

export const PRINCIPAL_QUERY_ROOT = "principal"
export const UNRESOLVED_PRINCIPAL = "__auth_unresolved__"

export function principalId(userId: string | null | undefined): string {
  return userId ?? UNRESOLVED_PRINCIPAL
}

const root = (userId: string, feature: string) =>
  [PRINCIPAL_QUERY_ROOT, userId, feature] as const

export const recipeKeys = {
  all: (userId: string) => root(userId, "recipes"),
  list: (userId: string, filters: {
    category: string | null
    search: string | null
    favoritesOnly: boolean
    tags: string[]
    limit: number | null
  }) => [...root(userId, "recipes"), "list", {
    ...filters,
    tags: [...filters.tags].sort(),
  }] as const,
  detail: (userId: string, recipeId: string | null) =>
    [...root(userId, "recipes"), "detail", recipeId] as const,
  weekly: (userId: string, recipeIds: string[]) =>
    [...root(userId, "recipes"), "weekly", [...recipeIds].sort()] as const,
}

export const shoppingKeys = {
  all: (userId: string) => root(userId, "shopping-list"),
  detail: (userId: string) => [...root(userId, "shopping-list"), "detail"] as const,
}

export const pantryKeys = {
  all: (userId: string) => root(userId, "pantry"),
  list: (userId: string) => [...root(userId, "pantry"), "list"] as const,
}

export const plannerKeys = {
  all: (userId: string) => root(userId, "planner"),
  week: (userId: string, weekDate: string) =>
    [...root(userId, "planner"), "week", weekDate] as const,
}

export const templateKeys = {
  all: (userId: string) => root(userId, "plan-templates"),
  list: (userId: string) => [...root(userId, "plan-templates"), "list"] as const,
}

export const configurationKeys = {
  all: (userId: string) => root(userId, "user-configuration"),
  detail: (userId: string) => [...root(userId, "user-configuration"), "detail"] as const,
  categories: (userId: string) => [...root(userId, "user-configuration"), "categories"] as const,
}

export const historyKeys = {
  all: (userId: string) => root(userId, "recipe-history"),
  list: (userId: string) => [...root(userId, "recipe-history"), "list"] as const,
  recent: (userId: string, daysBack: number) =>
    [...root(userId, "recipe-history"), "recent", daysBack] as const,
  stats: (userId: string) => [...root(userId, "recipe-history"), "stats"] as const,
}

export const shareKeys = {
  all: (userId: string) => root(userId, "recipe-shares"),
  inbox: (userId: string) => [...root(userId, "recipe-shares"), "inbox"] as const,
  sent: (userId: string) => [...root(userId, "recipe-shares"), "sent"] as const,
}

export function isPrincipalQueryKey(queryKey: QueryKey): boolean {
  return queryKey[0] === PRINCIPAL_QUERY_ROOT && typeof queryKey[1] === "string"
}

export function isPrincipalQueryFor(queryKey: QueryKey, userId: string): boolean {
  return isPrincipalQueryKey(queryKey) && queryKey[1] === userId
}
