import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { removeForeignPrincipalQueries, removePrincipalQueries } from "@/lib/principal-cache"
import { pantryKeys, recipeKeys, shoppingKeys } from "@/lib/query-keys"

describe("principal cache cleanup", () => {
  it("cancels and removes only the previous principal", async () => {
    const queryClient = new QueryClient()
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries")
    queryClient.setQueryData(recipeKeys.all("user-a"), ["A recipe"])
    queryClient.setQueryData(shoppingKeys.detail("user-a"), ["A shopping"])
    queryClient.setQueryData(pantryKeys.list("user-b"), ["B pantry"])
    queryClient.setQueryData(["public", "units"], ["cup"])

    await removePrincipalQueries(queryClient, "user-a")

    expect(cancelSpy).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(recipeKeys.all("user-a"))).toBeUndefined()
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toBeUndefined()
    expect(queryClient.getQueryData(pantryKeys.list("user-b"))).toEqual(["B pantry"])
    expect(queryClient.getQueryData(["public", "units"])).toEqual(["cup"])
  })

  it("removes foreign optimistic writes without touching the active principal", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(recipeKeys.all("user-a"), ["late optimistic A"])
    queryClient.setQueryData(recipeKeys.all("user-b"), ["B recipe"])

    removeForeignPrincipalQueries(queryClient, "user-b")

    expect(queryClient.getQueryData(recipeKeys.all("user-a"))).toBeUndefined()
    expect(queryClient.getQueryData(recipeKeys.all("user-b"))).toEqual(["B recipe"])
  })
})
