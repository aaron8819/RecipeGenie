import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  PlannerActionBar,
  PlannerDayAddButton,
  PlannerDaySection,
  PlannerDesktopWeekShell,
  PlannerEmptyWeekPanel,
  PlannerMobileHeader,
  PlannerMobileTabBar,
  PlannerMobileWeekStrip,
  PlannerSectionShell,
} from "../meal-planner-components"

describe("PlannerDaySection", () => {
  it("renders header, children, and forwarded section attributes", () => {
    render(
      <PlannerDaySection
        as="section"
        header={<h2>Tuesday 12</h2>}
        headerClassName="border-b"
        className="space-y-4"
        data-day-index={2}
      >
        <div>Recipe cards</div>
      </PlannerDaySection>
    )

    expect(screen.getByText("Tuesday 12")).toBeInTheDocument()
    expect(screen.getByText("Recipe cards")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Tuesday 12" }).closest("section")).toHaveAttribute(
      "data-day-index",
      "2"
    )
  })
})

describe("PlannerSectionShell", () => {
  it("renders header content and body children", () => {
    render(
      <PlannerSectionShell
        header={<div>Quick Meal Mix</div>}
        headerClassName="mb-4"
        className="lg:col-span-8"
      >
        <button type="button">Generate Plan</button>
      </PlannerSectionShell>
    )

    expect(screen.getByText("Quick Meal Mix")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate Plan" })).toBeInTheDocument()
  })
})

describe("PlannerDesktopWeekShell", () => {
  it("renders child day content and forwards week navigation callbacks", () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()

    render(
      <PlannerDesktopWeekShell onPrevious={onPrevious} onNext={onNext}>
        <div>Sunday column</div>
        <div>Monday column</div>
      </PlannerDesktopWeekShell>
    )

    expect(screen.getByText("Sunday column")).toBeInTheDocument()
    expect(screen.getByText("Monday column")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
    fireEvent.click(screen.getByRole("button", { name: "Next week" }))

    expect(onPrevious).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe("PlannerMobileHeader", () => {
  it("renders week label, progress, and optional controls", () => {
    render(
      <PlannerMobileHeader
        weekLabel="Mar 3 - Mar 9"
        showControls={true}
        controls={<button type="button">Pick week</button>}
        progressLabel="2 of 5 meals"
        progressValue={40}
      />
    )

    expect(screen.getByText("Mar 3 - Mar 9")).toBeInTheDocument()
    expect(screen.getByText("2 of 5 meals")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pick week" })).toBeInTheDocument()
  })
})

describe("PlannerMobileTabBar", () => {
  it("renders tabs and forwards selected tab clicks", () => {
    const onToday = vi.fn()
    const onThisWeek = vi.fn()

    render(
      <PlannerMobileTabBar
        tabs={[
          { key: "today", label: "Today", isActive: true, onClick: onToday },
          { key: "thisWeek", label: "This Week", isActive: false, onClick: onThisWeek },
        ]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Today" }))
    fireEvent.click(screen.getByRole("button", { name: "This Week" }))

    expect(onToday).toHaveBeenCalledTimes(1)
    expect(onThisWeek).toHaveBeenCalledTimes(1)
  })
})

describe("PlannerActionBar", () => {
  it("renders leading mobile chrome and action children", () => {
    render(
      <PlannerActionBar leading={<div>Tab strip</div>}>
        <button type="button">Add</button>
        <button type="button">Cart</button>
      </PlannerActionBar>
    )

    expect(screen.getByText("Tab strip")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cart" })).toBeInTheDocument()
  })
})

describe("PlannerEmptyWeekPanel", () => {
  it("renders empty-week copy and supplied controls", () => {
    render(
      <PlannerEmptyWeekPanel>
        <button type="button">Generate Plan</button>
      </PlannerEmptyWeekPanel>
    )

    expect(screen.getByText("Plan your week")).toBeInTheDocument()
    expect(screen.getByText(/select how many meals you want/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate Plan" })).toBeInTheDocument()
  })
})

describe("PlannerDayAddButton", () => {
  it("renders a day-specific add CTA and forwards clicks", () => {
    const onClick = vi.fn()

    render(
      <PlannerDayAddButton
        onClick={onClick}
        ariaLabel="Add meal to Tuesday"
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add meal to Tuesday" }))

    expect(screen.getByText("Add Meal")).toBeInTheDocument()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe("PlannerMobileWeekStrip", () => {
  it("renders day entries and forwards day selection", () => {
    const onSelectSunday = vi.fn()

    render(
      <PlannerMobileWeekStrip
        days={[
          {
            key: "sun",
            shortLabel: "Sun",
            dayNumber: 2,
            isToday: true,
            ariaLabel: "Scroll to Sunday, March 2",
            onSelect: onSelectSunday,
          },
          {
            key: "mon",
            shortLabel: "Mon",
            dayNumber: 3,
            isToday: false,
            ariaLabel: "Scroll to Monday, March 3",
            onSelect: () => {},
          },
        ]}
      />
    )

    expect(screen.getByText("Sun")).toBeInTheDocument()
    expect(screen.getByText("Mon")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Scroll to Sunday, March 2" }))
    expect(onSelectSunday).toHaveBeenCalledTimes(1)
  })
})
