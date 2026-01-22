"use client"

import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  tagCounts?: Array<{ tag: string; count: number }>
  placeholder?: string
  className?: string
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  tagCounts,
  placeholder = "Add tags...",
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Get available tags (from tagCounts if available, otherwise from suggestions)
  // Filter out any undefined/null/non-string values
  const availableTags = (tagCounts 
    ? tagCounts.map(tc => tc.tag).filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
    : suggestions.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== ''))

  // Create a map of tag to count for quick lookup
  const tagCountMap = tagCounts 
    ? new Map(tagCounts.filter(tc => typeof tc.tag === 'string').map(tc => [tc.tag, tc.count]))
    : new Map<string, number>()

  // Filter suggestions based on input and exclude already selected tags
  const filteredSuggestions = availableTags
    .filter((tag) => {
      const lowerTag = tag.toLowerCase()
      const lowerInput = inputValue.toLowerCase()
      return (
        lowerTag.includes(lowerInput) &&
        !value.includes(tag)
      )
    })
    .slice(0, inputValue.length > 0 ? 10 : 20) // Show more when input is empty

  // Get all unselected tags for the "all tags" view
  const unselectedTags = availableTags.filter(tag => !value.includes(tag))

  const handleAddTag = (tag: string) => {
    const trimmedTag = tag.trim()
    if (trimmedTag && !value.includes(trimmedTag)) {
      onChange([...value, trimmedTag])
      setInputValue("")
      setShowSuggestions(false)
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove))
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault()
      handleAddTag(inputValue)
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      // Remove last tag on backspace when input is empty
      handleRemoveTag(value[value.length - 1])
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
      inputRef.current?.blur()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    setShowSuggestions(true)
  }

  const handleSuggestionClick = (suggestion: string) => {
    handleAddTag(suggestion)
    setShowAllTags(false)
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
        setShowAllTags(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Selected Tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((tag) => {
            const colors = getTagClassName(tag, false)
            return (
              <span
                key={tag}
                className={cn("inline-flex items-center gap-1", colors)}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:opacity-70 rounded-full p-0.5 transition-opacity"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Input Field */}
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onFocus={() => {
            setShowSuggestions(true)
            setShowAllTags(true)
          }}
          placeholder={value.length === 0 ? placeholder : "Add another tag..."}
          className="pr-8"
        />

        {/* Suggestions Dropdown */}
        {showSuggestions && (filteredSuggestions.length > 0 || showAllTags) && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-64 overflow-auto">
            {inputValue.length === 0 && showAllTags && unselectedTags.length > 0 ? (
              // Show all available tags as clickable chips when input is empty
              <div className="p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Click to add tags:
                </div>
                <div className="flex flex-wrap gap-2">
                  {unselectedTags.map((tag) => {
                    const count = tagCountMap.get(tag)
                    const colors = getTagClassName(tag, false)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleSuggestionClick(tag)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm transition-colors hover:opacity-80",
                          colors
                        )}
                      >
                        {tag}
                        {count !== undefined && (
                          <span className="text-xs opacity-70">({count})</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : filteredSuggestions.length > 0 ? (
              // Show filtered suggestions when typing
              <div className="p-1">
                {filteredSuggestions.map((suggestion) => {
                  const count = tagCountMap.get(suggestion)
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-between"
                    >
                      <span>{suggestion}</span>
                      {count !== undefined && (
                        <span className="text-xs text-muted-foreground ml-2">
                          ({count})
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Hint for creating new tag */}
      {inputValue.trim() &&
        !filteredSuggestions.some(
          (s) => s.toLowerCase() === inputValue.trim().toLowerCase()
        ) && (
          <div className="mt-1 text-xs text-muted-foreground">
            Press Enter to add "{inputValue.trim()}"
          </div>
        )}
    </div>
  )
}
