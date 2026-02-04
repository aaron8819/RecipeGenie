export const CATEGORY_HEX_COLORS: Record<string, string> = {
  chicken: "#4d7c0f",
  beef: "#b91c1c",
  lamb: "#c2410c",
  turkey: "#a16207",
  vegetarian: "#1d4ed8",
}

export function getCategoryHexColor(category: string): string {
  return CATEGORY_HEX_COLORS[category.toLowerCase()] || "#6b7280"
}
