import { describe, expect, it } from "vitest"
import { assertSafePublicRecipeUrl, isPrivateIpAddress, UnsafeUrlError } from "@/lib/url-safety"

describe("isPrivateIpAddress", () => {
  it("detects private and loopback ipv4 ranges", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("10.10.0.1")).toBe(true)
    expect(isPrivateIpAddress("172.16.10.2")).toBe(true)
    expect(isPrivateIpAddress("192.168.1.9")).toBe(true)
    expect(isPrivateIpAddress("169.254.3.4")).toBe(true)
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false)
  })

  it("detects private and loopback ipv6 ranges", () => {
    expect(isPrivateIpAddress("::1")).toBe(true)
    expect(isPrivateIpAddress("fc00::1")).toBe(true)
    expect(isPrivateIpAddress("fd12:3456::1")).toBe(true)
    expect(isPrivateIpAddress("fe80::1")).toBe(true)
    expect(isPrivateIpAddress("2606:4700:4700::1111")).toBe(false)
  })
})

describe("assertSafePublicRecipeUrl", () => {
  it("rejects non-https urls", async () => {
    await expect(assertSafePublicRecipeUrl("http://example.com")).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it("rejects localhost hostnames", async () => {
    await expect(assertSafePublicRecipeUrl("https://localhost/recipe")).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it("rejects urls resolving to private ip", async () => {
    await expect(
      assertSafePublicRecipeUrl(
        "https://recipes.example.com/chili",
        async () => ["10.0.0.5"]
      )
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it("accepts public urls", async () => {
    const parsed = await assertSafePublicRecipeUrl(
      "https://recipes.example.com/chili",
      async () => ["93.184.216.34"]
    )
    expect(parsed.hostname).toBe("recipes.example.com")
  })
})
