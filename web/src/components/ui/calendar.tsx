"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

interface CalendarProps {
  selected?: Date
  onSelect?: (date: Date) => void
  className?: string
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = []
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Add days from previous month to fill the first week
  const startDayOfWeek = firstDay.getDay()
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const date = new Date(year, month, -i)
    days.push(date)
  }

  // Add all days in the current month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    days.push(new Date(year, month, day))
  }

  // Add days from next month to complete the last week
  const remainingDays = 7 - (days.length % 7)
  if (remainingDays < 7) {
    for (let i = 1; i <= remainingDays; i++) {
      days.push(new Date(year, month + 1, i))
    }
  }

  return days
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export function Calendar({ selected, onSelect, className }: CalendarProps) {
  const [viewDate, setViewDate] = React.useState(() => selected || new Date())

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const days = getDaysInMonth(year, month)

  const goToPrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1))
  }

  const goToNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1))
  }

  const handleSelectDate = (date: Date) => {
    onSelect?.(date)
  }

  return (
    <div className={cn("p-3", className)}>
      {/* Header with month/year and navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={goToPrevMonth}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {MONTHS[month]} {year}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={goToNextMonth}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          const isCurrentMonth = date.getMonth() === month
          const isSelected = selected && isSameDay(date, selected)
          const isTodayDate = isToday(date)

          return (
            <button
              key={index}
              onClick={() => handleSelectDate(date)}
              className={cn(
                "h-8 w-8 text-sm rounded-md transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                !isCurrentMonth && "text-muted-foreground opacity-50",
                isSelected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                isTodayDate && !isSelected && "bg-accent text-accent-foreground font-semibold"
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>

      {/* Today button */}
      <div className="mt-3 pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            const today = new Date()
            setViewDate(today)
            onSelect?.(today)
          }}
        >
          Go to today
        </Button>
      </div>
    </div>
  )
}
