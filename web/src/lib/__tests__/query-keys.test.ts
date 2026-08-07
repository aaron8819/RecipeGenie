import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  configurationKeys,
  historyKeys,
  isPrincipalQueryFor,
  pantryKeys,
  plannerKeys,
  recipeKeys,
  shareKeys,
  shoppingKeys,
  templateKeys,
} from "@/lib/query-keys"

const USER_A = "user-a"
const USER_B = "user-b"

const featureKeys = (userId: string) => [
  recipeKeys.list(userId, {
    category: null,
    search: null,
    favoritesOnly: false,
    tags: ["quick"],
    limit: null,
  }),
  recipeKeys.detail(userId, "recipe-1"),
  shoppingKeys.detail(userId),
  pantryKeys.list(userId),
  plannerKeys.week(userId, "2026-07-13"),
  templateKeys.list(userId),
  configurationKeys.detail(userId),
  configurationKeys.categories(userId),
  historyKeys.list(userId),
  historyKeys.recent(userId, 14),
  historyKeys.stats(userId),
  shareKeys.inbox(userId),
  shareKeys.sent(userId),
]

describe("principal query keys", () => {
  it("places the authenticated user in every private key", () => {
    expect(featureKeys(USER_A).every((key) => key[0] === "principal" && key[1] === USER_A)).toBe(true)
  })

  it("separates identical requests for different users", () => {
    expect(featureKeys(USER_A)).not.toEqual(featureKeys(USER_B))
  })

  it("matches only one principal with a principal-wide filter", () => {
    expect(featureKeys(USER_A).every((key) => isPrincipalQueryFor(key, USER_A))).toBe(true)
    expect(featureKeys(USER_B).some((key) => isPrincipalQueryFor(key, USER_A))).toBe(false)
  })

  it("normalizes unordered recipe tags", () => {
    const filters = { category: null, search: null, favoritesOnly: false, limit: null }
    expect(recipeKeys.list(USER_A, { ...filters, tags: ["quick", "dinner"] }))
      .toEqual(recipeKeys.list(USER_A, { ...filters, tags: ["dinner", "quick"] }))
  })

  it("keeps authenticated hooks free of legacy inline private roots", () => {
    const files = [
      "hooks/use-recipes.ts",
      "hooks/use-pantry.ts",
      "hooks/use-planner.ts",
      "hooks/use-plan-templates.ts",
      "hooks/use-recipe-shares.ts",
      "hooks/shared/user-config.ts",
      "hooks/shopping/use-shopping-document.ts",
      "app/(authenticated)/authenticated-shell.tsx",
    ]
    const legacyPrivateKey = /queryKey:\s*\[\s*["'](?:recipes|shopping_list|pantry|weekly_plans|recipe_history|user_config|plan-templates|recipe_shares)["']/

    for (const file of files) {
      expect(readFileSync(join(process.cwd(), "src", file), "utf8"), file)
        .not.toMatch(legacyPrivateKey)
    }
  })
})
