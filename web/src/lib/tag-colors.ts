/**
 * Tag color utility functions
 * Provides consistent color coding for category tags and custom user tags
 */

// Category tag color mappings
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  chicken: {
    bg: "bg-sage-100",
    text: "text-sage-700",
  },
  beef: {
    bg: "bg-red-100",
    text: "text-red-700",
  },
  lamb: {
    bg: "bg-orange-100",
    text: "text-orange-700",
  },
  turkey: {
    bg: "bg-yellow-100",
    text: "text-yellow-800", // Using darker yellow for better readability
  },
  vegetarian: {
    bg: "bg-blue-100",
    text: "text-blue-700",
  },
}

// Predefined color palette for custom tags
// Using a variety of colors that are distinct from category colors
const CUSTOM_TAG_COLORS = [
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-pink-100", text: "text-pink-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-cyan-100", text: "text-cyan-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-lime-100", text: "text-lime-700" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
]

/**
 * Simple hash function to convert string to number
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Get color classes for a tag
 * @param tag - The tag name (category or custom tag)
 * @param isCategory - Whether this is a category tag
 * @returns Object with bg and text className strings
 */
export function getTagColor(
  tag: string | null | undefined,
  isCategory: boolean = false
): { bg: string; text: string } {
  // Handle null/undefined tags
  if (!tag) {
    return {
      bg: "bg-gray-100",
      text: "text-gray-700",
    }
  }
  
  const normalizedTag = tag.toLowerCase().trim()

  // Check if it's a category tag
  if (isCategory || CATEGORY_COLORS[normalizedTag]) {
    return (
      CATEGORY_COLORS[normalizedTag] || {
        bg: "bg-gray-100",
        text: "text-gray-700",
      }
    )
  }

  // For custom tags, use deterministic color assignment based on hash
  const hash = hashString(normalizedTag)
  const colorIndex = hash % CUSTOM_TAG_COLORS.length
  return CUSTOM_TAG_COLORS[colorIndex]
}

/**
 * Get className string for tag badge styling
 * @param tag - The tag name
 * @param isCategory - Whether this is a category tag
 * @returns Combined className string
 */
export function getTagClassName(
  tag: string | null | undefined,
  isCategory: boolean = false
): string {
  const colors = getTagColor(tag, isCategory)
  return `${colors.bg} ${colors.text} px-2.5 py-1 rounded-full text-xs font-medium`
}
