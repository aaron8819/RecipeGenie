import React, { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ShoppingItemRow } from "@/components/shopping/shopping-list-components"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

globalThis.React = React

if (typeof window !== "undefined") {
  const testWindow = globalThis as typeof globalThis & {
    PointerEvent?: typeof MouseEvent
    ResizeObserver?: new () => {
      observe: () => void
      unobserve: () => void
      disconnect: () => void
    }
  }

  testWindow.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  testWindow.ResizeObserver ??= class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.scrollIntoView ??= () => {}
}

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
}

function ActionMenu(props: { modal?: boolean }) {
  return (
    <DropdownMenu modal={props.modal}>
      <DropdownMenuTrigger asChild>
        <button type="button">Open menu</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ShoppingRowShell() {
  const [activeTab, setActiveTab] = useState<"shopping" | "planner">("shopping")
  const [showRow, setShowRow] = useState(true)

  return (
    <div>
      <button type="button" onClick={() => setActiveTab("shopping")}>
        Shopping tab
      </button>
      <button type="button" onClick={() => setActiveTab("planner")}>
        Planner tab
      </button>

      <div aria-hidden={activeTab !== "shopping"}>
        {showRow ? (
          <ShoppingItemRow
            item={{
              rowId: "row-avocado-oil",
              item: "avocado oil",
              amount: null,
              unit: "",
              categoryKey: "pantry",
              categoryOrder: 1,
              checked: false,
              sources: [{ recipeId: "", recipeName: "Manual" }],
            }}
            isDesktop={false}
            isCheckingOff={false}
            isRemoving={false}
            isAddingToPantry={false}
            recipeColorMap={new Map()}
            onCheckOff={() => {}}
            onAddToPantry={() => setShowRow(false)}
            onRemove={() => setShowRow(false)}
          />
        ) : (
          <p>Row removed</p>
        )}
      </div>

      <div aria-hidden={activeTab !== "planner"}>
        {activeTab === "planner" ? (
          <button type="button">Planner action</button>
        ) : null}
      </div>
    </div>
  )
}

describe("DropdownMenu", () => {
  afterEach(() => {
    document.body.removeAttribute("data-scroll-locked")
    document.body.style.pointerEvents = ""
  })

  it("keeps default action menus non-modal and avoids global scroll locks", async () => {
    render(<ActionMenu />)

    openMenu(screen.getByRole("button", { name: "Open menu" }))

    expect(await screen.findByRole("menu")).toBeInTheDocument()
    expect(document.body).not.toHaveAttribute("data-scroll-locked")
    expect(document.body.style.pointerEvents).toBe("")
  })

  it("still allows explicit modal menus when a caller opts in", async () => {
    render(<ActionMenu modal />)

    openMenu(screen.getByRole("button", { name: "Open menu" }))

    expect(await screen.findByRole("menu")).toBeInTheDocument()

    await waitFor(() => {
      expect(document.body.getAttribute("data-scroll-locked")).toBeTruthy()
      expect(document.body.style.pointerEvents).toBe("none")
    })
  })

  it("cleans up after a shopping row action removes the row and the user changes tabs", async () => {
    render(<ShoppingRowShell />)

    openMenu(screen.getByRole("button", { name: "Item actions" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /remove from list/i }))

    expect(await screen.findByText("Row removed")).toBeInTheDocument()
    expect(document.body).not.toHaveAttribute("data-scroll-locked")
    expect(document.body.style.pointerEvents).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "Planner tab" }))
    expect(await screen.findByRole("button", { name: "Planner action" })).toBeEnabled()
  })
})
