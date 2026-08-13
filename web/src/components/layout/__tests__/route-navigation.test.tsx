import React, {
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BottomNav } from "../bottom-nav"
import { DesktopSidebar } from "../desktop-sidebar"
import { Header } from "../header"

globalThis.React = React

let pathname = "/recipes"
let linkPending = false

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: linkPending }),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

vi.mock("../onboarding-dialog", () => ({
  OnboardingDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}))

describe("route navigation", () => {
  beforeEach(() => {
    pathname = "/recipes"
    linkPending = false
  })

  it("renders the branded desktop sidebar and exact supported destinations", () => {
    const onSignOut = vi.fn()
    const { container } = render(
      <DesktopSidebar
        userEmail="cook@example.com"
        onSignOut={onSignOut}
      />
    )

    const sidebar = screen.getByRole("complementary", {
      name: "Recipe Genie desktop navigation",
    })
    expect(sidebar).toHaveClass("hidden", "w-64", "lg:flex")

    const brandLink = screen.getByRole("link", {
      name: "Go to Planner",
    })
    expect(brandLink).toHaveAttribute("href", "/planner")

    const brandLockup = container.querySelector(
      '[data-slot="recipe-genie-lockup"]'
    )
    expect(brandLockup).toHaveAttribute("src", "/recipe-genie-lockup.png")
    expect(brandLockup).toHaveAttribute("alt", "")
    expect(within(brandLink).queryByText("Recipe Genie")).not.toBeInTheDocument()

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    })
    const expectedDestinations = [
      ["Planner", "/planner"],
      ["Recipes", "/recipes"],
      ["Shopping", "/shopping"],
      ["Pantry", "/pantry"],
    ] as const

    for (const [label, href] of expectedDestinations) {
      expect(within(navigation).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }

    expect(
      within(navigation).getByRole("link", { name: "Recipes" })
    ).toHaveAttribute("aria-current", "page")
    expect(
      within(navigation).getByRole("link", { name: "Planner" })
    ).not.toHaveAttribute("aria-current")

    expect(screen.getByText("cook@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onSignOut).toHaveBeenCalledOnce()

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
    expect(screen.queryByText("Settings")).not.toBeInTheDocument()
    expect(screen.queryByText("Create Recipe")).not.toBeInTheDocument()
  })

  it("keeps nested Recipe routes active and exposes pending navigation", () => {
    pathname = "/recipes/recipe-1"
    linkPending = true
    render(<DesktopSidebar onSignOut={vi.fn()} />)

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    })
    expect(
      within(navigation).getByRole("link", { name: /Recipes/ })
    ).toHaveAttribute("aria-current", "page")
    expect(within(navigation).getByText("Loading Planner")).toBeInTheDocument()
  })

  it("preserves the mobile header and bottom navigation boundary", () => {
    const { container } = render(
      <>
        <Header userEmail="cook@example.com" onSignOut={vi.fn()} />
        <BottomNav />
      </>
    )

    expect(screen.getByRole("banner")).toHaveClass("lg:hidden")
    expect(
      screen.getByRole("navigation", { name: "Bottom navigation" })
    ).toHaveClass("lg:hidden")
    expect(screen.getByRole("link", { name: "Go to Planner" })).toHaveAttribute(
      "href",
      "/planner"
    )
    expect(
      container.querySelector('[data-slot="recipe-genie-mark"]')
    ).toHaveAttribute("src", "/recipe-genie-mark.png")
    expect(
      within(screen.getByRole("link", { name: "Go to Planner" })).queryByText(
        "Recipe Genie"
      )
    ).not.toBeInTheDocument()

    const bottomNavigation = screen.getByRole("navigation", {
      name: "Bottom navigation",
    })
    expect(
      within(bottomNavigation).getByRole("link", { name: "Recipes" })
    ).toHaveAttribute("aria-current", "page")
    expect(within(bottomNavigation).getAllByRole("link")).toHaveLength(4)
  })
})
