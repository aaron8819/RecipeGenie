"use client"

import { useState, useRef, useEffect } from "react"
import { Check, ChevronDown, X, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const [searchQuery, setSearchQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Create a map of tag to count for quick lookup
  const tagCountMap = tagCounts 
    ? new Map(tagCounts.map(tc => [tc.tag, tc.count]))
    : new Map<string, number>()

  // Filter options based on search query
  const filteredOptions = options.filter((option) => {
    if (!searchQuery) return true
    return option.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const handleRemoveTag = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter((v) => v !== tag))
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
        setSearchQuery("")
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      // Focus search input when dropdown opens
      if (searchInputRef.current && options.length > 5) {
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
      }
    } else {
      setSearchQuery("")
    }
  }, [open, options.length])

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(!open)}
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
                      <button
                        type="button"
                        onClick={(e) => handleRemoveTag(tag, e)}
                        className="hover:opacity-70 rounded-full p-0.5 transition-opacity"
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
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
            <button
              type="button"
              onClick={handleClear}
              className="rounded-full p-0.5 hover:bg-muted transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 opacity-50 transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </Button>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-hidden flex flex-col">
          {/* Search input */}
          {options.length > 5 && (
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}
          <div className="overflow-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {searchQuery ? "No tags match your search" : "No tags available"}
              </div>
            ) : (
              filteredOptions.map((option) => {
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
                    <span className="flex-1">{option}</span>
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
        </div>
      )}
    </div>
  )
}
