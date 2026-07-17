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

type QueryResult<T> = { data: T | null; error: unknown | null }

type FilterBuilder<T> = PromiseLike<QueryResult<T>> & {
  eq: (column: string, value: unknown) => FilterBuilder<T>
  filter: (column: string, operator: "eq", value: string) => FilterBuilder<T>
  select: (columns: string) => FilterBuilder<T>
  maybeSingle: () => Promise<QueryResult<T extends Array<infer Row> ? Row : T>>
}

type TableBuilder = {
  select: (columns: string) => FilterBuilder<unknown[]>
  update: (values: Record<string, unknown>) => FilterBuilder<unknown[]>
  delete: () => FilterBuilder<unknown[]>
}

type RecipeDeletionClient = {
  rpc: (
    fn: "delete_recipe",
    args: { p_recipe_uuid: string }
  ) => Promise<{ error: unknown | null }>
  from: (table: string) => TableBuilder
}

type WeeklyPlanReferenceRow = {
  week_date: string
  recipe_ids: string[]
  recipe_uuids: string[]
  day_assignments: Record<string, unknown> | null
  day_assignment_recipe_uuids: Record<string, unknown> | null
  made_recipe_ids: string[] | null
  made_recipe_uuids: string[]
}

type TemplateReferenceRow = {
  id: string
  recipe_ids: string[]
  recipe_uuids: string[]
  day_assignments: Record<string, unknown> | null
  day_assignment_recipe_uuids: Record<string, unknown> | null
}

export type Migration011CleanupResult = {
  shoppingList?: unknown
}

type Migration011Cleanup = (recipeUuid: string) => Promise<Migration011CleanupResult>

export class Migration011DeletionConflictError extends Error {
  constructor(surface: "weekly plan" | "plan template") {
    super(`Recipe deletion stopped because a ${surface} changed concurrently; retry safely`)
    this.name = "Migration011DeletionConflictError"
  }
}

export class Migration011DeletionPartialFailureError extends Error {
  constructor() {
    super(
      "Recipe deletion did not report success because a concurrent migration-011 write left an active reference"
    )
    this.name = "Migration011DeletionPartialFailureError"
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

function without<T extends string>(values: T[] | null, target: string): T[] {
  return (values || []).filter((value) => value !== target)
}

function withoutKey(
  values: Record<string, unknown> | null,
  target: string
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values || {}).filter(([key]) => key !== target)
  )
}

function postgresUuidArray(values: string[]): string {
  return `{${values.join(",")}}`
}

function hasReference(
  recipeUuid: string,
  legacyId: string,
  row: WeeklyPlanReferenceRow | TemplateReferenceRow
): boolean {
  return row.recipe_uuids.includes(recipeUuid)
    || row.recipe_ids.includes(legacyId)
    || recipeUuid in (row.day_assignment_recipe_uuids || {})
    || legacyId in (row.day_assignments || {})
    || ("made_recipe_uuids" in row && row.made_recipe_uuids.includes(recipeUuid))
    || ("made_recipe_ids" in row && (row.made_recipe_ids || []).includes(legacyId))
}

async function readReferenceRows(
  client: RecipeDeletionClient,
  ownerUserId: string
): Promise<{
  plans: WeeklyPlanReferenceRow[]
  templates: TemplateReferenceRow[]
}> {
  const [plansResult, templatesResult] = await Promise.all([
    client.from("weekly_plans")
      .select(
        "week_date,recipe_ids,recipe_uuids,day_assignments,day_assignment_recipe_uuids,made_recipe_ids,made_recipe_uuids"
      )
      .eq("user_id", ownerUserId),
    client.from("plan_templates")
      .select(
        "id,recipe_ids,recipe_uuids,day_assignments,day_assignment_recipe_uuids"
      )
      .eq("user_id", ownerUserId),
  ])
  if (plansResult.error) throw plansResult.error
  if (templatesResult.error) throw templatesResult.error
  return {
    plans: (plansResult.data || []) as WeeklyPlanReferenceRow[],
    templates: (templatesResult.data || []) as TemplateReferenceRow[],
  }
}

async function updatePlan(
  client: RecipeDeletionClient,
  ownerUserId: string,
  recipeUuid: string,
  legacyId: string,
  plan: WeeklyPlanReferenceRow
): Promise<void> {
  const result = await client.from("weekly_plans")
    .update({
      recipe_uuids: without(plan.recipe_uuids, recipeUuid),
      recipe_ids: without(plan.recipe_ids, legacyId),
      day_assignment_recipe_uuids: withoutKey(
        plan.day_assignment_recipe_uuids, recipeUuid
      ),
      day_assignments: withoutKey(plan.day_assignments, legacyId),
      made_recipe_uuids: without(plan.made_recipe_uuids, recipeUuid),
      made_recipe_ids: without(plan.made_recipe_ids, legacyId),
    })
    .eq("user_id", ownerUserId)
    .eq("week_date", plan.week_date)
    .filter("recipe_uuids", "eq", postgresUuidArray(plan.recipe_uuids))
    .filter(
      "day_assignment_recipe_uuids",
      "eq",
      JSON.stringify(plan.day_assignment_recipe_uuids || {})
    )
    .filter("made_recipe_uuids", "eq", postgresUuidArray(plan.made_recipe_uuids))
    .select("week_date")
  if (result.error) throw result.error
  if (!result.data || result.data.length !== 1) {
    throw new Migration011DeletionConflictError("weekly plan")
  }
}

async function updateTemplate(
  client: RecipeDeletionClient,
  ownerUserId: string,
  recipeUuid: string,
  legacyId: string,
  template: TemplateReferenceRow
): Promise<void> {
  const result = await client.from("plan_templates")
    .update({
      recipe_uuids: without(template.recipe_uuids, recipeUuid),
      recipe_ids: without(template.recipe_ids, legacyId),
      day_assignment_recipe_uuids: withoutKey(
        template.day_assignment_recipe_uuids, recipeUuid
      ),
      day_assignments: withoutKey(template.day_assignments, legacyId),
    })
    .eq("user_id", ownerUserId)
    .eq("id", template.id)
    .filter("recipe_uuids", "eq", postgresUuidArray(template.recipe_uuids))
    .filter(
      "day_assignment_recipe_uuids",
      "eq",
      JSON.stringify(template.day_assignment_recipe_uuids || {})
    )
    .select("id")
  if (result.error) throw result.error
  if (!result.data || result.data.length !== 1) {
    throw new Migration011DeletionConflictError("plan template")
  }
}

async function deleteWithMigration011Compatibility(
  client: RecipeDeletionClient,
  recipeUuid: string,
  ownerUserId: string,
  cleanupShopping?: Migration011Cleanup
): Promise<Migration011CleanupResult | undefined> {
  const recipeResult = await client.from("recipes")
    .select("id")
    .eq("recipe_uuid", recipeUuid)
    .eq("user_id", ownerUserId)
    .maybeSingle()
  if (recipeResult.error) throw recipeResult.error
  const legacyId = ((recipeResult.data as { id?: string } | null)?.id || recipeUuid)
  const references = await readReferenceRows(client, ownerUserId)
  const plans = references.plans.filter((row) => hasReference(recipeUuid, legacyId, row))
  const templates = references.templates.filter((row) => hasReference(recipeUuid, legacyId, row))

  // Migration 011 cannot make these calls atomic. Shopping is cleaned first to
  // satisfy the restrictive contribution FK; every later failure is surfaced.
  const cleanupResult = recipeResult.data && cleanupShopping
    ? await cleanupShopping(recipeUuid)
    : undefined

  for (const plan of plans) {
    await updatePlan(client, ownerUserId, recipeUuid, legacyId, plan)
  }
  for (const template of templates) {
    await updateTemplate(client, ownerUserId, recipeUuid, legacyId, template)
  }

  const deleteResult = await client.from("recipes")
    .delete()
    .eq("recipe_uuid", recipeUuid)
    .eq("user_id", ownerUserId)
  if (deleteResult.error) throw deleteResult.error

  const remaining = await readReferenceRows(client, ownerUserId)
  if (
    remaining.plans.some((row) => hasReference(recipeUuid, legacyId, row))
    || remaining.templates.some((row) => hasReference(recipeUuid, legacyId, row))
  ) {
    throw new Migration011DeletionPartialFailureError()
  }
  return cleanupResult
}

/** Delete by canonical UUID on both migration 011 and migration 012. */
export async function deleteRecipeByUuid(
  client: unknown,
  recipeUuid: string,
  ownerUserId: string,
  cleanupShopping?: Migration011Cleanup
): Promise<Migration011CleanupResult | undefined> {
  const id = assertRecipeUuid(recipeUuid)
  const deletionClient = client as RecipeDeletionClient
  const rpcResult = await deletionClient.rpc("delete_recipe", { p_recipe_uuid: id })

  if (!rpcResult.error) return undefined
  if (!isMissingDeleteRecipeRpc(rpcResult.error)) throw rpcResult.error

  return deleteWithMigration011Compatibility(
    deletionClient,
    id,
    ownerUserId,
    cleanupShopping
  )
}
