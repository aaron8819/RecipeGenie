import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ShoppingItem } from "@/types/database"
import {
  ShoppingCategorySection,
  ShoppingItemRow,
  ShoppingStateSection,
} from "../shopping-list-components"

function item(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    item: "apples",
    amount: 2,
    unit: "lb",
    checked: false,
    categoryKey: "produce",
    categoryOrder: 1,
    sources: [],
    ...overrides,
  }
}

describe("ShoppingCategorySection", () => {
  it("renders grouped category state and triggers section actions", () => {
    const onToggleCategory = vi.fn()
    const onBulkCheckOff = vi.fn()

    render(
      <ShoppingCategorySection
        categoryData={{
          key: "produce",
          name: "Produce",
          isCustom: true,
          checkedCount: 1,
          totalCount: 3,
        }}
        itemCount={3}
        isCollapsed={false}
        isDragTarget={true}
        isBulkCheckOffPending={false}
        onToggleCategory={onToggleCategory}
        onBulkCheckOff={onBulkCheckOff}
      >
        <div>Spinach row</div>
      </ShoppingCategorySection>
    )

    expect(screen.getByText("Produce")).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByText("1/3")).toBeInTheDocument()
    expect(screen.getByText("Spinach row")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Check all items in Produce" }))
    expect(onBulkCheckOff).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Collapse category" }))
    expect(onToggleCategory).toHaveBeenCalledTimes(1)
  })

  it("hides children when collapsed", () => {
    render(
      <ShoppingCategorySection
        categoryData={{
          key: "misc",
          name: "Misc",
          isCustom: false,
          checkedCount: 0,
          totalCount: 1,
        }}
        itemCount={1}
        isCollapsed={true}
        isDragTarget={false}
        isBulkCheckOffPending={false}
        onToggleCategory={() => {}}
        onBulkCheckOff={() => {}}
      >
        <div>Hidden child</div>
      </ShoppingCategorySection>
    )

    expect(screen.queryByText("Hidden child")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand category" })).toBeInTheDocument()
  })
})

describe("ShoppingItemRow", () => {
  it("renders desktop row actions, dedupes sources, and forwards callbacks", () => {
    const onCheckOff = vi.fn()
    const onAddToPantry = vi.fn()
    const onRemove = vi.fn()

    render(
      <ShoppingItemRow
        item={item({
          sources: [
            { recipeName: "Autumn Soup" },
            { recipeName: "Autumn Soup" },
          ],
        })}
        isDesktop={true}
        isCheckingOff={false}
        isRemoving={false}
        isAddingToPantry={false}
        recipeColorMap={new Map([["Autumn Soup", 1]])}
        onCheckOff={onCheckOff}
        onAddToPantry={onAddToPantry}
        onRemove={onRemove}
      />
    )

    expect(screen.getByText("2 lb")).toBeInTheDocument()
    expect(screen.getByText("apples")).toBeInTheDocument()
    expect(screen.getAllByText("Autumn Soup")).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Check off item" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to pantry" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove from list" }))

    expect(onCheckOff).toHaveBeenCalledTimes(1)
    expect(onAddToPantry).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("button", { name: "Item actions" }).className).toContain("hidden")
  })

  it("keeps mobile action trigger visible and disables busy actions", () => {
    render(
      <ShoppingItemRow
        item={item({ checked: true, item: "milk" })}
        isDesktop={false}
        isCheckingOff={true}
        isRemoving={true}
        isAddingToPantry={true}
        recipeColorMap={new Map()}
        onCheckOff={() => {}}
        onAddToPantry={() => {}}
        onRemove={() => {}}
        showSwipeHint={true}
      />
    )

    expect(screen.getByText("Swipe left to delete")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Uncheck item" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Item actions" }).className).not.toContain("hidden")
  })
})

describe("ShoppingStateSection", () => {
  it("renders title, count, and collapsed mobile toggle callbacks", () => {
    const onToggle = vi.fn()

    render(
      <ShoppingStateSection
        title="In Pantry"
        count={2}
        icon={<span data-testid="section-icon">I</span>}
        isDesktop={false}
        isCollapsed={true}
        onToggle={onToggle}
        expandLabel="Expand pantry items"
        collapseLabel="Collapse pantry items"
        mobileCountClassName="bg-emerald-100 text-emerald-700"
        mobileContent={<div>Mobile pantry body</div>}
        desktopContent={<div>Desktop pantry body</div>}
      />
    )

    expect(screen.getAllByText("In Pantry")).toHaveLength(2)
    expect(screen.getAllByText("2")).toHaveLength(2)
    expect(screen.getAllByTestId("section-icon")).toHaveLength(2)
    expect(screen.queryByText("Mobile pantry body")).not.toBeInTheDocument()
    expect(screen.getByText("Desktop pantry body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expand pantry items" }))
    fireEvent.keyDown(screen.getAllByRole("button")[0], { key: "Enter" })

    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it("shows expanded mobile content and keeps desktop content rendered", () => {
    render(
      <ShoppingStateSection
        title="Excluded"
        count={1}
        isDesktop={false}
        isCollapsed={false}
        onToggle={() => {}}
        expandLabel="Expand excluded items"
        collapseLabel="Collapse excluded items"
        mobileCountClassName="bg-rose-100 text-rose-700"
        mobileContent={<div>Mobile excluded body</div>}
        desktopContent={<div>Desktop excluded body</div>}
      />
    )

    expect(screen.getByText("Mobile excluded body")).toBeInTheDocument()
    expect(screen.getByText("Desktop excluded body")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse excluded items" })).toBeInTheDocument()
  })
})
