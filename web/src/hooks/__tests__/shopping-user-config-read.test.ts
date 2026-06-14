import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchShoppingGenerationConfig,
  saveShoppingItemOrderPreference,
} from "@/hooks/shopping/user-config-read"

const single = vi.fn()
const maybeSingle = vi.fn()
const select = vi.fn(() => ({ single, maybeSingle }))
const upsert = vi.fn()
const from = vi.fn(() => ({ select, upsert }))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(() => ({ from })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  single.mockResolvedValue({ data: null, error: null })
  maybeSingle.mockResolvedValue({ data: null, error: null })
  upsert.mockResolvedValue({ data: null, error: null })
})

describe("shopping user config reads", () => {
  it("keeps excluded keywords when shopping item order is unavailable", async () => {
    single
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'shopping_item_order' column",
        },
      })
      .mockResolvedValueOnce({
        data: {
          excluded_keywords: ["salt"],
          category_overrides: { garlic: "produce" },
        },
        error: null,
      })

    const config = await fetchShoppingGenerationConfig()

    expect(config).toEqual({
      excluded_keywords: ["salt"],
      category_overrides: { garlic: "produce" },
    })
    expect(select).toHaveBeenNthCalledWith(
      1,
      "excluded_keywords, category_overrides, shopping_item_order"
    )
    expect(select).toHaveBeenNthCalledWith(
      2,
      "excluded_keywords, category_overrides"
    )
  })

  it("does not hide unrelated config read failures", async () => {
    single.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    })

    await expect(fetchShoppingGenerationConfig()).rejects.toEqual({
      code: "42501",
      message: "permission denied",
    })
  })

  it("treats shopping item order writes as optional during schema cache lag", async () => {
    upsert.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST204",
        message: "Could not find the 'shopping_item_order' column",
      },
    })

    await expect(
      saveShoppingItemOrderPreference("user-1", { produce: ["garlic"] })
    ).resolves.toBeUndefined()
  })
})
