import { createClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deleteRecipeByUuid, isMissingDeleteRecipeRpc } from "@/lib/recipe-deletion"
import { mapRecipeRow, recipeUuidWrite, type RecipeRow } from "@/lib/recipe-identity"
import type { Database } from "@/types/database.generated"

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Stage 2C matrix environment omitted ${name}`)
  return value
}

const schemaVersion = requiredEnvironment("STAGE2C_MATRIX_SCHEMA")
const apiUrl = requiredEnvironment("STAGE2C_MATRIX_API_URL")
const anonKey = requiredEnvironment("STAGE2C_MATRIX_ANON_KEY")
const serviceRoleKey = requiredEnvironment("STAGE2C_MATRIX_SERVICE_ROLE_KEY")
if (schemaVersion !== "011" && schemaVersion !== "012") {
  throw new Error(`Unsupported Stage 2C matrix schema: ${schemaVersion}`)
}

const OWNER_RECIPE = "81111111-1111-4111-8111-111111111111"
const SAME_NAME_RECIPE = "81222222-2222-4222-8222-222222222222"
const OTHER_OWNER_RECIPE = "82333333-3333-4333-8333-333333333333"
const sharedName = "Stage 2C Duplicate Name"

const createMatrixClient = (key: string) => createClient<Database>(apiUrl, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const admin = createMatrixClient(serviceRoleKey)
let owner: ReturnType<typeof createMatrixClient>
let otherOwner: ReturnType<typeof createMatrixClient>
let ownerId = ""
let otherOwnerId = ""

async function createAuthenticatedClient(label: string) {
  const unique = crypto.randomUUID()
  const email = `stage2c-${schemaVersion}-${label}-${unique}@example.test`
  const password = `Matrix-${crypto.randomUUID()}-Aa1!`
  let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>> | undefined
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (!created.error) break
      if (created.error.name !== "AuthRetryableFetchError" || attempt === 19) {
        throw created.error
      }
    } catch (error) {
      if (
        attempt === 19
        || !error
        || typeof error !== "object"
        || !("name" in error)
        || error.name !== "AuthRetryableFetchError"
      ) {
        throw error
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!created) throw new Error("User creation did not complete")
  if (created.error || !created.data.user) throw created.error || new Error("User creation failed")

  const client = createMatrixClient(anonKey)
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return { client, userId: created.data.user.id }
}

async function insertRecipe(
  client: ReturnType<typeof createMatrixClient>,
  userId: string,
  recipeUuid: string,
  name = sharedName
) {
  const result = await client
    .from("recipes")
    .insert({
      ...recipeUuidWrite(recipeUuid),
      user_id: userId,
      name,
      category: "Matrix",
      servings: 4,
      ingredients: [],
      instructions: [],
    })
    .select("*")
    .single()
  if (result.error) throw result.error
  return mapRecipeRow(result.data as RecipeRow)
}

async function removeContributionFirst(recipeUuid: string) {
  const runCommand = async (adding: boolean) => {
    const current = await owner.from("shopping_list").select("*").single()
    if (current.error) throw current.error
    const command = await owner.rpc("apply_recipe_shopping_contribution_uuid_command", {
      p_expected_revision: current.data.contribution_revision,
      p_contributions: adding ? [{
        recipe_uuid: recipeUuid,
        servings: 4,
        scale: 1,
        normalization_version: 1,
        snapshot: { recipeName: sharedName, items: [] },
      }] : [],
      p_remove_recipe_uuids: adding ? [] : [recipeUuid],
      p_projection: {
        items: current.data.items,
        already_have: current.data.already_have,
        excluded: current.data.excluded,
        source_recipe_uuids: adding ? [recipeUuid] : [],
        scale: current.data.scale,
        total_servings: adding ? 4 : 0,
        custom_order: current.data.custom_order,
        generated_at: current.data.generated_at,
        legacy_items_preserved: current.data.legacy_items_preserved,
      },
      p_contribution_overrides: current.data.contribution_overrides,
      p_idempotency_key: crypto.randomUUID(),
      p_command_type: adding ? "add_or_replace" : "remove",
    })
    if (command.error) throw command.error
  }

  await runCommand(true)
  const created = await owner
    .from("shopping_recipe_contributions")
    .select("recipe_uuid", { count: "exact", head: true })
    .eq("recipe_uuid", recipeUuid)
  if (created.error) throw created.error
  expect(created.count).toBe(1)

  await runCommand(false)

  const remaining = await owner
    .from("shopping_recipe_contributions")
    .select("recipe_uuid", { count: "exact", head: true })
    .eq("recipe_uuid", recipeUuid)
  if (remaining.error) throw remaining.error
  expect(remaining.count).toBe(0)
}

beforeAll(async () => {
  const ownerAccount = await createAuthenticatedClient("owner")
  owner = ownerAccount.client
  ownerId = ownerAccount.userId
  const otherAccount = await createAuthenticatedClient("other")
  otherOwner = otherAccount.client
  otherOwnerId = otherAccount.userId
})

afterAll(async () => {
  if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  if (otherOwnerId) await admin.auth.admin.deleteUser(otherOwnerId)
})

describe(`Stage 2C application against migration ${schemaVersion}`, () => {
  it("creates matching UUID/text pairs with stable canonical identity and duplicate names", async () => {
    const first = await insertRecipe(owner, ownerId, OWNER_RECIPE)
    const duplicateName = await insertRecipe(owner, ownerId, SAME_NAME_RECIPE)
    await insertRecipe(otherOwner, otherOwnerId, OTHER_OWNER_RECIPE)

    expect(first).toMatchObject({ id: OWNER_RECIPE, legacyId: OWNER_RECIPE, name: sharedName })
    expect(duplicateName).toMatchObject({
      id: SAME_NAME_RECIPE,
      legacyId: SAME_NAME_RECIPE,
      name: sharedName,
    })
    expect(first.id).not.toBe(duplicateName.id)
    expect(first.id).not.toContain("stage-2c-duplicate-name")

    const renamed = await owner
      .from("recipes")
      .update({ name: "Renamed Matrix Recipe" })
      .eq("recipe_uuid", OWNER_RECIPE)
      .select("*")
      .single()
    if (renamed.error) throw renamed.error
    expect(mapRecipeRow(renamed.data as RecipeRow).id).toBe(OWNER_RECIPE)

    if (schemaVersion === "012") {
      const mismatch = await owner.from("recipes").insert({
        id: "89999999-9999-4999-8999-999999999999",
        recipe_uuid: "89888888-8888-4888-8888-888888888888",
        user_id: ownerId,
        name: "Mismatch",
        category: "Matrix",
      })
      expect(mismatch.error).toMatchObject({ code: "23503" })

      const legacyOnly = await owner.from("recipes").insert({
        id: "legacy-only-matrix",
        user_id: ownerId,
        name: "Legacy only",
        category: "Matrix",
      } as never)
      expect(legacyOnly.error).toMatchObject({ code: "22023" })
    }
  })

  it("cleans contributions first and deletes through the schema-appropriate UUID path", async () => {
    await removeContributionFirst(OWNER_RECIPE)

    let fallbackCalls = 0
    const observedClient = {
      rpc: owner.rpc.bind(owner),
      from: (table: "recipes") => {
        fallbackCalls += 1
        return owner.from(table)
      },
    }

    if (schemaVersion === "011") {
      const capability = await owner.rpc("delete_recipe" as never, {
        p_recipe_uuid: OWNER_RECIPE,
      } as never)
      expect(isMissingDeleteRecipeRpc(capability.error)).toBe(true)
    }

    await deleteRecipeByUuid(observedClient, OWNER_RECIPE, ownerId)
    expect(fallbackCalls).toBe(schemaVersion === "011" ? 1 : 0)

    const deleted = await admin
      .from("recipes")
      .select("recipe_uuid", { count: "exact", head: true })
      .eq("recipe_uuid", OWNER_RECIPE)
    expect(deleted.count).toBe(0)

    const unrelated = await admin
      .from("recipes")
      .select("recipe_uuid", { count: "exact", head: true })
      .in("recipe_uuid", [SAME_NAME_RECIPE, OTHER_OWNER_RECIPE])
    expect(unrelated.count).toBe(2)

    const crossOwnerClient = {
      rpc: owner.rpc.bind(owner),
      from: (table: "recipes") => owner.from(table),
    }
    if (schemaVersion === "012") {
      await expect(
        deleteRecipeByUuid(crossOwnerClient, OTHER_OWNER_RECIPE, ownerId)
      ).rejects.toMatchObject({ code: "23503" })
    } else {
      await deleteRecipeByUuid(crossOwnerClient, OTHER_OWNER_RECIPE, ownerId)
    }
    const crossOwnerStillExists = await admin
      .from("recipes")
      .select("recipe_uuid", { count: "exact", head: true })
      .eq("recipe_uuid", OTHER_OWNER_RECIPE)
    expect(crossOwnerStillExists.count).toBe(1)
  })
})
