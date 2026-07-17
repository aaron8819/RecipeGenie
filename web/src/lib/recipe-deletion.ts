import { assertRecipeUuid } from "@/lib/recipe-identity"

const MISSING_DELETE_RECIPE_RPC_MESSAGE =
  "Could not find the function public.delete_recipe(p_recipe_uuid) in the schema cache"
const MISSING_DELETE_RECIPE_RPC_DETAILS =
  "Searched for the function public.delete_recipe with parameter p_recipe_uuid or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache."

type PostgrestErrorLike = {
  code?: unknown
  details?: unknown
  message?: unknown
}

type RecipeDeletionClient = {
  rpc: (
    fn: "delete_recipe",
    args: { p_recipe_uuid: string }
  ) => Promise<{ error: unknown | null }>
  from: (table: "recipes") => {
    delete: () => {
      eq: (column: "recipe_uuid", value: string) => {
        eq: (
          column: "user_id",
          value: string
        ) => Promise<{ error: unknown | null }>
      }
    }
  }
}

/** Exact migration-011 PostgREST capability response. No capability is cached. */
export function isMissingDeleteRecipeRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const candidate = error as PostgrestErrorLike
  return candidate.code === "PGRST202"
    && candidate.message === MISSING_DELETE_RECIPE_RPC_MESSAGE
    && candidate.details === MISSING_DELETE_RECIPE_RPC_DETAILS
}

/** Delete by canonical UUID on both migration 011 and migration 012. */
export async function deleteRecipeByUuid(
  client: unknown,
  recipeUuid: string,
  ownerUserId: string
): Promise<void> {
  const id = assertRecipeUuid(recipeUuid)
  const deletionClient = client as RecipeDeletionClient
  const rpcResult = await deletionClient.rpc("delete_recipe", { p_recipe_uuid: id })

  if (!rpcResult.error) return
  if (!isMissingDeleteRecipeRpc(rpcResult.error)) throw rpcResult.error

  const fallbackResult = await deletionClient
    .from("recipes")
    .delete()
    .eq("recipe_uuid", id)
    .eq("user_id", ownerUserId)

  if (fallbackResult.error) throw fallbackResult.error
}
