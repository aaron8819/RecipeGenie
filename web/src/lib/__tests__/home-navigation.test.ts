import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  persistHomeTab,
  readPersistedHomeTab,
} from "../home-navigation"

const COOKIE_NAME = "recipe-genie-active-tab"
const RECONCILIATION_COOKIE_NAME =
  "recipe-genie-active-tab-reconciliation"
const STORAGE_KEY = "recipe-genie-active-tab"

function readCookie(name: string) {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")[1]
}

describe("home navigation persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0`
    document.cookie = `${RECONCILIATION_COOKIE_NAME}=; Path=/; Max-Age=0`
  })

  it("persists the same tab to local storage and the fallback cookie", () => {
    persistHomeTab("shopping")

    expect(localStorage.getItem(STORAGE_KEY)).toBe("shopping")
    expect(readCookie(COOKIE_NAME)).toBe("shopping")
    expect(readCookie(RECONCILIATION_COOKIE_NAME)).toBeUndefined()
  })

  it("marks the fallback cookie authoritative when local-storage writes throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage) {
      if (this === localStorage) throw new Error("local storage unavailable")
    })

    expect(() => persistHomeTab("recipes")).not.toThrow()
    expect(readCookie(COOKIE_NAME)).toBe("recipes")
    expect(readCookie(RECONCILIATION_COOKIE_NAME)).toBe("recipes")
  })

  it("clears a pending reconciliation after local storage catches up", () => {
    document.cookie = `${RECONCILIATION_COOKIE_NAME}=recipes; Path=/`

    persistHomeTab("recipes")

    expect(localStorage.getItem(STORAGE_KEY)).toBe("recipes")
    expect(readCookie(RECONCILIATION_COOKIE_NAME)).toBeUndefined()
  })

  it("fails safely when local-storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage) {
      if (this === localStorage) throw new Error("local storage unavailable")
      return null
    })

    expect(() => readPersistedHomeTab()).not.toThrow()
    expect(readPersistedHomeTab()).toBeNull()
  })

  it("rejects arbitrary persisted values", () => {
    localStorage.setItem(STORAGE_KEY, "https://example.com")

    expect(readPersistedHomeTab()).toBeNull()
  })
})
