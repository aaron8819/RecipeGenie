"use client"

import { useState } from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface MultiSelectProps {
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  className?: string
  tagCounts?: Array<{ tag: string; count: number }>
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select tags...",
  className,
  tagCounts,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)

  // Create a map of tag to count for quick lookup
  const tagCountMap = tagCounts 
    ? new Map(tagCounts.map(tc => [tc.tag, tc.count]))
    : new Map<string, number>()

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  const handleClear = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onChange([])
  }

  const handleRemoveTag = (tag: string, e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(value.filter((v) => v !== tag))
  }

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-between text-left font-normal",
              !value.length && "text-muted-foreground"
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {value.length === 0 ? (
                <span>{placeholder}</span>
              ) : value.length === 1 ? (
                <span className="truncate">{value[0]}</span>
              ) : (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <span className="text-xs text-muted-foreground">
                    {value.length} selected
                  </span>
                  <div className="flex gap-1 flex-1 min-w-0 overflow-hidden">
                    {value.slice(0, 2).map((tag) => {
                      const colors = getTagClassName(tag, false)
                      return (
                        <span
                          key={tag}
                          className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap",
                            colors
                          )}
                        >
                          {tag}
                          <span
                            role="button"
                            tabIndex={0}
                            onMouseDown={(e) => handleRemoveTag(tag, e)}
                            onClick={(e) => handleRemoveTag(tag, e)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                handleRemoveTag(tag, e)
                              }
                            }}
                            className="hover:opacity-70 rounded-full p-0.5 transition-opacity"
                            aria-label={`Remove ${tag}`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </span>
                        </span>
                      )
                    })}
                    {value.length > 2 && (
                      <span className="text-xs text-muted-foreground">
                        +{value.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {value.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onMouseDown={handleClear}
                  onClick={handleClear}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleClear(e)
                    }
                  }}
                  className="rounded-full p-0.5 hover:bg-muted transition-colors"
                  aria-label="Clear selection"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronDown
                className={cn(
                  "h-4 w-4 opacity-50 transition-transform",
                  open && "rotate-180"
                )}
              />
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          <div className="max-h-60 overflow-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No tags available
              </div>
            ) : (
              options.map((option) => {
                const isSelected = value.includes(option)
                const count = tagCountMap.get(option)
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleOption(option)}
                    className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border flex-shrink-0",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <span className="flex-1 min-w-0 truncate">{option}</span>
                    {count !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        ({count})
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
