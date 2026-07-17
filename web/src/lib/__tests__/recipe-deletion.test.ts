import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteRecipeByUuid,
  isMissingDeleteRecipeRpc,
  Migration011DeletionConflictError,
} from "@/lib/recipe-deletion"

const RECIPE_UUID = "71111111-1111-4111-8111-111111111111"
const OTHER_UUID = "72222222-2222-4222-8222-222222222222"
const OWNER_ID = "user-a"
const MISSING_RPC_ERROR = {
  code: "PGRST202",
  details:
    "Searched for the function public.delete_recipe with parameter p_recipe_uuid or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  hint: null,
  message:
    "Could not find the function public.delete_recipe(p_recipe_uuid) in the schema cache",
}

type Row = Record<string, unknown>
type State = Record<string, Row[]>

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fakeClient({
  rpcError = MISSING_RPC_ERROR,
  failUpdate,
}: {
  rpcError?: unknown | null
  failUpdate?: string
} = {}) {
  const state: State = {
    recipes: [{ id: "legacy-a", recipe_uuid: RECIPE_UUID, user_id: OWNER_ID }],
    weekly_plans: [{
      user_id: OWNER_ID,
      week_date: "2026-07-20",
      recipe_ids: ["legacy-a", "legacy-a", "legacy-b"],
      recipe_uuids: [RECIPE_UUID, RECIPE_UUID, OTHER_UUID],
      day_assignments: { "legacy-a": 2, "legacy-b": 4 },
      day_assignment_recipe_uuids: { [RECIPE_UUID]: 2, [OTHER_UUID]: 4 },
      made_recipe_ids: ["legacy-a", "legacy-b", "legacy-a"],
      made_recipe_uuids: [RECIPE_UUID, OTHER_UUID, RECIPE_UUID],
    }, {
      user_id: "user-b",
      week_date: "2026-07-20",
      recipe_ids: [RECIPE_UUID],
      recipe_uuids: [RECIPE_UUID],
      day_assignments: { [RECIPE_UUID]: 1 },
      day_assignment_recipe_uuids: { [RECIPE_UUID]: 1 },
      made_recipe_ids: [RECIPE_UUID],
      made_recipe_uuids: [RECIPE_UUID],
    }],
    plan_templates: [{
      id: "template-a",
      user_id: OWNER_ID,
      recipe_ids: ["legacy-b", "legacy-a", "legacy-a"],
      recipe_uuids: [OTHER_UUID, RECIPE_UUID, RECIPE_UUID],
      day_assignments: { "legacy-a": 5, "legacy-b": 6 },
      day_assignment_recipe_uuids: { [RECIPE_UUID]: 5, [OTHER_UUID]: 6 },
    }],
  }

  const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError })
  const from = vi.fn((table: string) => {
    const makeBuilder = (operation: "select" | "update" | "delete", values?: Row) => {
      const filters: Array<[string, unknown]> = []
      const execute = () => {
        if (operation === "update" && failUpdate === table) {
          return { data: null, error: new Error(`${table} cleanup failed`) }
        }
        const rows = state[table] || []
        const matches = (row: Row) => filters.every(([key, value]) => equal(row[key], value))
        if (operation === "select") {
          return { data: rows.filter(matches).map((row) => ({ ...row })), error: null }
        }
        if (operation === "update") {
          const changed = rows.filter(matches)
          changed.forEach((row) => Object.assign(row, values))
          return { data: changed.map((row) => ({ ...row })), error: null }
        }
        const deleted = rows.filter(matches)
        state[table] = rows.filter((row) => !matches(row))
        return { data: deleted, error: null }
      }
      const builder = {
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return builder
        },
        filter(column: string, _operator: "eq", value: string) {
          const parsed = value.startsWith("{") && value.endsWith("}") && !value.includes(":")
            ? value.slice(1, -1).split(",").filter(Boolean)
            : JSON.parse(value)
          filters.push([column, parsed])
          return builder
        },
        select() {
          return builder
        },
        async maybeSingle() {
          const result = execute()
          return { ...result, data: result.data?.[0] || null }
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject)
        },
      }
      return builder
    }
    return {
      select: () => makeBuilder("select"),
      update: (values: Row) => makeBuilder("update", values),
      delete: () => makeBuilder("delete"),
    }
  })
  return { client: { rpc, from }, state, rpc, from }
}

describe("isMissingDeleteRecipeRpc", () => {
  it("recognizes only the exact migration-011 missing-function response", () => {
    expect(isMissingDeleteRecipeRpc(MISSING_RPC_ERROR)).toBe(true)
    expect(isMissingDeleteRecipeRpc({ ...MISSING_RPC_ERROR, code: "42501" })).toBe(false)
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
  beforeEach(() => vi.clearAllMocks())

  it("cleans every owned planner/template reference before migration-011 deletion", async () => {
    const { client, state } = fakeClient()
    const cleanupShopping = vi.fn().mockResolvedValue({ shoppingList: { items: [] } })

    const result = await deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID, cleanupShopping)

    expect(result).toEqual({ shoppingList: { items: [] } })
    expect(cleanupShopping).toHaveBeenCalledWith(RECIPE_UUID)
    expect(state.recipes).toEqual([])
    expect(state.weekly_plans[0]).toMatchObject({
      recipe_uuids: [OTHER_UUID],
      day_assignment_recipe_uuids: { [OTHER_UUID]: 4 },
      made_recipe_uuids: [OTHER_UUID],
    })
    expect(state.plan_templates[0]).toMatchObject({
      recipe_uuids: [OTHER_UUID],
      day_assignment_recipe_uuids: { [OTHER_UUID]: 6 },
    })
    expect(state.weekly_plans[1].recipe_uuids).toEqual([RECIPE_UUID])
  })

  it("does not report success when a compatible cleanup step fails", async () => {
    const { client, state } = fakeClient({ failUpdate: "weekly_plans" })
    const cleanupShopping = vi.fn().mockResolvedValue({})

    await expect(
      deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID, cleanupShopping)
    ).rejects.toThrow("weekly_plans cleanup failed")
    expect(cleanupShopping).toHaveBeenCalledOnce()
    expect(state.recipes).toHaveLength(1)
  })

  it("surfaces optimistic concurrency conflicts without deleting the recipe", async () => {
    const { client, state } = fakeClient()
    const originalFrom = client.from
    client.from = ((table: string) => {
      const builder = originalFrom(table)
      if (table !== "weekly_plans") return builder
      const originalUpdate = builder.update
      builder.update = (values: Row) => {
        state.weekly_plans[0].recipe_uuids = [RECIPE_UUID, OTHER_UUID, OTHER_UUID]
        return originalUpdate(values)
      }
      return builder
    }) as typeof client.from

    await expect(
      deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID, async () => ({}))
    ).rejects.toBeInstanceOf(Migration011DeletionConflictError)
    expect(state.recipes).toHaveLength(1)
  })

  it.each([
    ["permission errors", { ...MISSING_RPC_ERROR, code: "42501" }],
    ["generic missing messages", { code: "PGRST202", message: "not found" }],
    ["runtime errors", {
      code: "PGRST202",
      message: MISSING_RPC_ERROR.message,
      details: "delete_recipe was not found after the function began running",
    }],
  ])("propagates %s without fallback", async (_label, error) => {
    const { client, from } = fakeClient({ rpcError: error })
    await expect(deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID)).rejects.toBe(error)
    expect(from).not.toHaveBeenCalled()
  })

  it("does not call migration-011 cleanup after RPC success", async () => {
    const { client, from } = fakeClient({ rpcError: null })
    const cleanupShopping = vi.fn()
    await deleteRecipeByUuid(client, RECIPE_UUID, OWNER_ID, cleanupShopping)
    expect(from).not.toHaveBeenCalled()
    expect(cleanupShopping).not.toHaveBeenCalled()
  })

  it("rejects malformed UUIDs before attempting either path", async () => {
    const { client, rpc, from } = fakeClient()
    await expect(deleteRecipeByUuid(client, "not-a-uuid", OWNER_ID)).rejects.toThrow(
      "must be a UUID"
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
})
