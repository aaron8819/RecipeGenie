import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteRecipeByUuid,
  isMissingDeleteRecipeRpc,
} from "@/lib/recipe-deletion"

const RECIPE_UUID = "71111111-1111-4111-8111-111111111111"
const OWNER_ID = "user-a"
const MISSING_RPC_ERROR = {
  code: "PGRST202",
  details:
    "Searched for the function public.delete_recipe with parameter p_recipe_uuid or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  hint: null,
  message:
    "Could not find the function public.delete_recipe(p_recipe_uuid) in the schema cache",
}

const fallbackResult = vi.fn()
const fallbackOwner = vi.fn(() => fallbackResult())
const fallbackUuid = vi.fn(() => ({ eq: fallbackOwner }))
const deleteRows = vi.fn(() => ({ eq: fallbackUuid }))
const fromRecipes = vi.fn(() => ({ delete: deleteRows }))
const rpc = vi.fn()
const client = { rpc, from: fromRecipes }

beforeEach(() => {
  vi.clearAllMocks()
  fallbackResult.mockResolvedValue({ error: null })
})

describe("isMissingDeleteRecipeRpc", () => {
  it("recognizes only the exact migration-011 missing-function response", () => {
    expect(isMissingDeleteRecipeRpc(MISSING_RPC_ERROR)).toBe(true)
    expect(isMissingDeleteRecipeRpc({
      ...MISSING_RPC_ERROR,
      code: "42501",
    })).toBe(false)
    expect(isMissingDeleteRecipeRpc({
      ...MISSING_RPC_ERROR,
      details: "The delete_recipe function was not found during runtime.",
    })).toBe(false)
    expect(isMissingDeleteRecipeRpc({
      ...MISSING_RPC_ERROR,
      message: `${MISSING_RPC_ERROR.message} after a timeout`,
    })).toBe(false)
  })
})

describe("deleteRecipeByUuid", () => {
  it("falls back by recipe_uuid and owner only for the exact capability error", async () => {
    rpc.mockResolvedValueOnce({ error: MISSING_RPC_ERROR })

    await deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)

    expect(rpc).toHaveBeenCalledWith("delete_recipe", { p_recipe_uuid: RECIPE_UUID })
    expect(fromRecipes).toHaveBeenCalledWith("recipes")
    expect(fallbackUuid).toHaveBeenCalledWith("recipe_uuid", RECIPE_UUID)
    expect(fallbackOwner).toHaveBeenCalledWith("user_id", OWNER_ID)
  })

  it.each([
    ["permission error", { code: "42501", message: "permission denied", details: null }],
    ["timeout", { code: "57014", message: "statement timeout", details: null }],
    ["server failure", { code: "XX000", message: "internal server error", details: null }],
    ["foreign-key failure", {
      code: "23503",
      message: "update or delete violates foreign key constraint",
      details: null,
    }],
    ["recipe not found", {
      code: "23503",
      message: "recipe UUID is unresolved or belongs to another user",
      details: null,
    }],
    ["similarly worded runtime failure", {
      code: "PGRST202",
      message: MISSING_RPC_ERROR.message,
      details: "delete_recipe was not found after the function began running",
    }],
  ])("propagates %s without fallback", async (_label, error) => {
    rpc.mockResolvedValueOnce({ error })

    await expect(deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)).rejects.toBe(error)
    expect(fromRecipes).not.toHaveBeenCalled()
  })

  it("does not call fallback after RPC success", async () => {
    rpc.mockResolvedValueOnce({ error: null })

    await deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)

    expect(fromRecipes).not.toHaveBeenCalled()
  })

  it("propagates network failures without fallback", async () => {
    const error = new TypeError("fetch failed")
    rpc.mockRejectedValueOnce(error)

    await expect(deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)).rejects.toBe(error)
    expect(fromRecipes).not.toHaveBeenCalled()
  })

  it("rejects malformed UUIDs before attempting either deletion path", async () => {
    await expect(deleteRecipeByUuid(client, "not-a-uuid", OWNER_ID)).rejects.toThrow(
      "must be a UUID"
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(fromRecipes).not.toHaveBeenCalled()
  })

  it("propagates fallback failures", async () => {
    const error = { code: "23503", message: "foreign key failure" }
    rpc.mockResolvedValueOnce({ error: MISSING_RPC_ERROR })
    fallbackResult.mockResolvedValueOnce({ error })

    await expect(deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)).rejects.toBe(error)
  })
})
