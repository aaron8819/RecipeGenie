import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ShoppingItem } from "@/types/database"
import {
  ManualShoppingItemEditor,
  ShoppingCategorySection,
  ShoppingItemRow,
  ShoppingProgressSummary,
  ShoppingRestoreChip,
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
          uncheckedCount: 2,
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
    expect(screen.getByText("2 left")).toBeInTheDocument()
    expect(screen.getByText("1 done")).toBeInTheDocument()
    expect(screen.getByText("Spinach row")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check all items in Produce" }).className).toContain("min-w-[44px]")
    expect(screen.getByRole("button", { name: "Collapse category" }).className).toContain("h-9")

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
          uncheckedCount: 1,
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

describe("ShoppingProgressSummary", () => {
  it("renders progress metrics and active category jump actions", () => {
    const onToggleCompleted = vi.fn()
    const onJumpToCategory = vi.fn()

    render(
      <ShoppingProgressSummary
        remainingCount={5}
        completedCount={3}
        totalCount={8}
        activeCategoryCount={2}
        hideCompletedItems={false}
        onToggleCompleted={onToggleCompleted}
        activeCategories={[
          { key: "produce", name: "Fresh Produce", remainingCount: 3 },
          { key: "pantry", name: "Pantry", remainingCount: 2 },
        ]}
        onJumpToCategory={onJumpToCategory}
      />
    )

    expect(screen.getByText("Progress")).toBeInTheDocument()
    expect(screen.getByText("38% done")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Hide 3 done" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Jump to Fresh Produce" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide 3 done" }))
    fireEvent.click(screen.getByRole("button", { name: "Jump to Pantry" }))

    expect(onToggleCompleted).toHaveBeenCalledTimes(1)
    expect(onJumpToCategory).toHaveBeenCalledWith("pantry")
  })
})

describe("ShoppingItemRow", () => {
  it("keeps management drag handles out of the default shopping row", () => {
    render(
      <ShoppingItemRow
        item={item()}
        isDesktop={true}
        isCheckingOff={false}
        isRemoving={false}
        isAddingToPantry={false}
        recipeColorMap={new Map()}
        onCheckOff={() => {}}
        onAddToPantry={() => {}}
        onRemove={() => {}}
      />
    )

    expect(screen.queryByRole("button", { name: "Drag to reorder" })).not.toBeInTheDocument()
  })

  it("renders desktop row actions, dedupes sources, and forwards callbacks", () => {
    const onCheckOff = vi.fn()
    const onAddToPantry = vi.fn()
    const onRemove = vi.fn()
    const onEdit = vi.fn()

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
        showDragHandle={true}
        onEdit={onEdit}
        onCheckOff={onCheckOff}
        onAddToPantry={onAddToPantry}
        onRemove={onRemove}
      />
    )

    expect(screen.getByText("2 lb")).toBeInTheDocument()
    expect(screen.getByText("apples")).toBeInTheDocument()
    expect(screen.getAllByText("Autumn Soup")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Drag to reorder" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add to pantry" }).parentElement?.className).toContain("opacity-70")

    fireEvent.click(screen.getByRole("button", { name: "Check off item" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit item" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to pantry" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove from list" }))

    expect(onCheckOff).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onAddToPantry).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("button", { name: "Item actions" }).className).toContain("hidden")
  })

  it("keeps mobile action trigger centered with consistent touch targets and disables busy actions", () => {
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

    expect(screen.getByTestId("shopping-item-row").className).toContain("items-center")
    expect(screen.getByText("Swipe left to delete")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Uncheck item" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Item actions" }).className).toContain("h-11")
    expect(screen.getByRole("button", { name: "Item actions" }).className).toContain("w-11")
    expect(screen.getByRole("button", { name: "Item actions" }).className).not.toContain("hidden")
  })

  it("renders compact provenance summaries in shopping mode", () => {
    const onViewRecipe = vi.fn()

    render(
      <ShoppingItemRow
        item={item({
          sources: [{ recipeName: "Weeknight Pasta" }],
        })}
        isDesktop={false}
        sourceDisplay="summary"
        isCheckingOff={false}
        isRemoving={false}
        isAddingToPantry={false}
        recipeColorMap={new Map()}
        onViewRecipe={onViewRecipe}
        onCheckOff={() => {}}
        onAddToPantry={() => {}}
        onRemove={() => {}}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "From Weeknight Pasta" }))
    expect(onViewRecipe).toHaveBeenCalledWith(undefined, "Weeknight Pasta")
  })

  it("summarizes multi-recipe provenance without flooding the row", () => {
    render(
      <ShoppingItemRow
        item={item({
          sources: [
            { recipeName: "Weeknight Pasta" },
            { recipeName: "Sunday Chili" },
            { recipeName: "Lunch Bowl" },
          ],
        })}
        isDesktop={false}
        sourceDisplay="summary"
        isCheckingOff={false}
        isRemoving={false}
        isAddingToPantry={false}
        recipeColorMap={new Map()}
        onCheckOff={() => {}}
        onAddToPantry={() => {}}
        onRemove={() => {}}
      />
    )

    expect(screen.getByText("From Weeknight Pasta + 2 more")).toBeInTheDocument()
  })

  it("adds manual edit actions to the mobile item menu when editing is allowed", () => {
    const onEdit = vi.fn()

    render(
      <ShoppingItemRow
        item={item({ item: "garlic" })}
        isDesktop={false}
        isCheckingOff={false}
        isRemoving={false}
        isAddingToPantry={false}
        recipeColorMap={new Map()}
        onEdit={onEdit}
        onCheckOff={() => {}}
        onAddToPantry={() => {}}
        onRemove={() => {}}
      />
    )

    expect(screen.getByRole("button", { name: "Item actions" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit item" }))

    expect(onEdit).toHaveBeenCalledTimes(1)
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
    expect(screen.getByRole("button", { name: "Collapse excluded items" }).className).toContain("h-9")
    expect(screen.getByRole("button", { name: "Collapse excluded items" }).className).toContain("w-9")
  })
})

describe("ShoppingRestoreChip", () => {
  it("renders amount, reason, and recipe origin for restore actions", () => {
    const onRestore = vi.fn()

    render(
      <ShoppingRestoreChip
        item={item({
          item: "milk",
          amount: 1,
          unit: "cup",
          sources: [{ recipeName: "Pasta Bake" }],
          excludedBy: "dairy",
        })}
        reasonLabel="Excluded: dairy"
        onRestore={onRestore}
        disabled={false}
        recipeColorMap={new Map([["Pasta Bake", 2]])}
        tone="excluded"
        compact={true}
      />
    )

    expect(screen.getByText("milk")).toBeInTheDocument()
    expect(screen.getByText("1 cup")).toBeInTheDocument()
    expect(screen.getByText("Excluded: dairy")).toBeInTheDocument()
    expect(screen.getByText("Pasta Bake")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Restore milk 1 cup Excluded: dairy" }))
    expect(onRestore).toHaveBeenCalledTimes(1)
  })
})

describe("ManualShoppingItemEditor", () => {
  it("submits and cancels without adding extra row noise", () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()

    render(
      <ManualShoppingItemEditor
        itemName="garlic"
        amount="1/2"
        unit="lb"
        isSaving={false}
        errorMessage="Duplicate item"
        onItemNameChange={() => {}}
        onAmountChange={() => {}}
        onUnitChange={() => {}}
        onSave={onSave}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText("Edit manual item")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Duplicate item")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
