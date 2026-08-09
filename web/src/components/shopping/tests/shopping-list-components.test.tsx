import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ShoppingItem } from "@/types/database"
import { normalizeShoppingItem } from "@/lib/recipe-data-validation"
import {
  formatAdditionalAmountParts,
  formatAmountPart,
  formatEncodedRangeAmount,
  formatShoppingItemAmount,
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

function chooseItemAction(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Item actions" }))
  fireEvent.click(screen.getByRole("menuitem", { name }))
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
        isDesktop
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

    const desktopSummary = within(screen.getByTestId("shopping-progress-desktop"))
    const desktopJumps = within(screen.getByTestId("shopping-progress-desktop-jumps"))
    expect(desktopSummary.getByText("Your progress")).toBeInTheDocument()
    expect(desktopSummary.getByLabelText("38% complete")).toBeInTheDocument()
    expect(desktopSummary.getByRole("button", { name: "Hide 3 done" })).toBeInTheDocument()
    expect(desktopJumps.getByRole("button", { name: "Jump to Fresh Produce" })).toBeInTheDocument()

    fireEvent.click(desktopSummary.getByRole("button", { name: "Hide 3 done" }))
    fireEvent.click(desktopJumps.getByRole("button", { name: "Jump to Pantry" }))

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
    expect(screen.getByRole("button", { name: "Item actions" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Check off item" }))
    chooseItemAction("Edit item")
    chooseItemAction("Add to pantry")
    chooseItemAction("Remove from list")

    expect(onCheckOff).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onAddToPantry).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("button", { name: "Item actions" }).className).not.toContain("hidden")
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

  it("moves additional amounts into a secondary line for easier scanning", () => {
    render(
      <ShoppingItemRow
        item={item({
          item: "garlic",
          amount: 3,
          unit: "clove",
          additionalAmounts: [{ amount: 1, unit: "head" }],
          sources: [{ recipeName: "Roast Chicken" }],
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

    expect(screen.getByText("3 cloves")).toBeInTheDocument()
    expect(screen.queryByText("3 cloves + 1 head")).not.toBeInTheDocument()
    expect(screen.getByText("Also: 1 head")).toBeInTheDocument()
    expect(screen.getByText("From Roast Chicken")).toBeInTheDocument()
  })

  it("shows prep-specific source details without repeating exact bare item forms", () => {
    render(
      <ShoppingItemRow
        item={item({
          item: "lime",
          amount: 4,
          unit: "count",
          sources: [
            { recipeName: "Pollo Asado Tacos", originalItem: "juice of 2 limes" },
            { recipeName: "Shredded Chipotle Beef", originalItem: "lime" },
            { recipeName: "Pollo Asado Tacos", originalItem: "lime wedges" },
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

    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("limes")).toBeInTheDocument()
    expect(screen.getByText("Needs: juice of 2 limes; lime wedges")).toBeInTheDocument()
    expect(screen.getByText("From Pollo Asado Tacos and Shredded Chipotle Beef")).toBeInTheDocument()
  })

  it.each([
    ["egg", 1, "egg"],
    ["egg", 2, "eggs"],
    ["large egg", 3, "large eggs"],
  ])("displays %s count %s as %s", (name, amount, expectedName) => {
    render(
      <ShoppingItemRow
        item={item({ item: name, amount, unit: "count" })}
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

    expect(screen.getByText(String(amount))).toBeInTheDocument()
    expect(screen.getByText(expectedName)).toBeInTheDocument()
  })

  it("pluralizes preserved package units for display", () => {
    render(
      <ShoppingItemRow
        item={item({
          item: "tomatoes",
          amount: 2,
          unit: "can",
        })}
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

    expect(screen.getByText("2 cans")).toBeInTheDocument()
    expect(screen.queryByText("2 can")).not.toBeInTheDocument()
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
    chooseItemAction("Edit item")

    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})

describe("shopping amount formatting", () => {
  it("pluralizes count and package units while preserving singular values", () => {
    expect(formatAmountPart(1, "count")).toBe("1")
    expect(formatAmountPart(2, "whole")).toBe("2")
    expect(formatAmountPart(1, "jar")).toBe("1 jar")
    expect(formatAmountPart(2, "jar")).toBe("2 jars")
    expect(formatAmountPart(3, "clove")).toBe("3 cloves")
    expect(formatAmountPart(2, "can (14 oz)")).toBe("2 cans (14 oz)")
  })

  it("renders encoded ingredient ranges without repeating the first endpoint", () => {
    expect(formatEncodedRangeAmount(0.5, "0.5-1 tsp")).toBe("0.5–1 tsp")
    expect(formatAmountPart(0.5, "0.5-1 tsp")).toBe("0.5–1 tsp")
    expect(
      formatShoppingItemAmount(item({ amount: 0.5, unit: "0.5-1 tsp" }))
    ).toBe("0.5–1 tsp")
  })

  it("formats exact scaled ranges and packages from structured metadata", () => {
    expect(
      formatShoppingItemAmount(
        item({
          amount: null,
          unit: "can (14 oz)",
          exactQuantityV1: {
            version: 1,
            kind: "range",
            authored: "3/2–3",
            source: "authored",
            start: { numerator: "3", denominator: "2" },
            end: { numerator: "3", denominator: "1" },
            startLexeme: "3/2",
            endLexeme: "3",
            separator: "–",
          },
          exactAuthoredUnit: "(14 oz) cans",
          exactPackageV1: {
            version: 1,
            count: {
              version: 1,
              kind: "range",
              authored: "3/2–3",
              source: "authored",
              start: { numerator: "3", denominator: "2" },
              end: { numerator: "3", denominator: "1" },
              startLexeme: "3/2",
              endLexeme: "3",
              separator: "–",
            },
            size: {
              value: { numerator: "14", denominator: "1" },
              lexeme: "14",
              unit: "oz",
              authoredUnit: "oz",
            },
            type: "can",
            authoredType: "cans",
          },
        })
      )
    ).toBe("1½–3 14 oz cans")
  })

  it("renders the compatibility unit after hydration strips contradictory metadata", () => {
    const hydrated = normalizeShoppingItem({
      ...item({ amount: 1, unit: "cup" }),
      exactQuantityV1: {
        version: 1,
        kind: "exact",
        authored: "1",
        source: "authored",
        value: { numerator: "1", denominator: "1" },
        lexeme: "1",
      },
      exactAuthoredUnit: "lb",
    })
    expect(hydrated).not.toBeNull()
    expect(formatShoppingItemAmount(hydrated!)).toBe("1 cup")
  })

  it("formats additional amounts independently from the primary amount", () => {
    expect(formatAdditionalAmountParts([{ amount: 2, unit: "package" }, { amount: 1, unit: "head" }])).toEqual([
      "2 packages",
      "1 head",
    ])
    expect(
      formatShoppingItemAmount(
        item({
          amount: 1,
          unit: "jar",
          additionalAmounts: [{ amount: 2, unit: "can" }],
        })
      )
    ).toBe("1 jar + 2 cans")
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
