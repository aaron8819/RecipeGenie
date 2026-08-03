import React from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BottomNav } from "../bottom-nav"
import { Header } from "../header"

globalThis.React = React

let pathname = "/recipes"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

vi.mock("@/hooks/use-is-desktop", () => ({
  useIsDesktop: () => true,
}))

vi.mock("../onboarding-dialog", () => ({
  OnboardingDialog: () => null,
}))

describe("route navigation", () => {
  beforeEach(() => {
    pathname = "/recipes"
  })

  it("renders desktop destinations as normal active links", () => {
    render(<Header userEmail="user@example.com" onSignOut={vi.fn()} />)

    const recipes = screen.getByRole("link", { name: "Recipes" })
    expect(recipes).toHaveAttribute("href", "/recipes")
    expect(recipes).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Planner" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("keeps Recipes active for nested detail routes on mobile", () => {
    pathname = "/recipes/recipe-1"
    render(<BottomNav />)

    const recipes = screen.getByRole("link", { name: "Recipes" })
    expect(recipes).toHaveAttribute("href", "/recipes")
    expect(recipes).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Shopping" })).not.toHaveAttribute(
      "aria-current"
    )
  })
})
