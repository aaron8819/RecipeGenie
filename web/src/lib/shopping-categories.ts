/**
 * Shopping categories for ingredient categorization.
 * Categories are ordered by typical grocery store layout.
 * Ported from app.py:47-146
 */

export interface ShoppingCategory {
  order: number
  name: string
  keywords: string[]
}

export const SHOPPING_CATEGORIES: Record<string, ShoppingCategory> = {
  produce: {
    order: 1,
    name: "Fresh Produce",
    keywords: [
      // Vegetables
      "lettuce", "spinach", "kale", "arugula", "cabbage", "bok choy",
      "tomato", "tomatoes", "cherry tomatoes", "grape tomatoes",
      "onion", "onions", "red onion", "yellow onion", "white onion", "shallot", "shallots",
      "garlic", "ginger", "scallion", "scallions", "green onion", "green onions",
      "pepper", "peppers", "bell pepper", "bell peppers", "jalapeno", "jalapenos", "serrano",
      "cucumber", "cucumbers", "zucchini", "squash", "eggplant",
      "carrot", "carrots", "celery", "broccoli", "cauliflower", "asparagus",
      "mushroom", "mushrooms", "portobello", "shiitake", "cremini",
      "potato", "potatoes", "sweet potato", "sweet potatoes", "yam", "yams",
      "corn", "peas", "green beans", "snap peas", "snow peas",
      "avocado", "avocados",
      // Fruits
      "apple", "apples", "banana", "bananas", "orange", "oranges",
      "lemon", "lemons", "lime", "limes", "grapefruit",
      "strawberry", "strawberries", "blueberry", "blueberries", "raspberry", "raspberries",
      "blackberry", "blackberries", "grape", "grapes",
      "mango", "mangoes", "pineapple", "watermelon", "cantaloupe", "honeydew",
      "peach", "peaches", "plum", "plums", "nectarine", "nectarines",
      "pear", "pears", "kiwi", "cherry", "cherries", "pomegranate",
      // Fresh herbs
      "cilantro", "parsley", "basil", "mint", "dill", "chives",
      "rosemary", "thyme", "sage", "oregano", "tarragon",
    ]
  },
  deli: {
    order: 2,
    name: "Deli",
    keywords: [
      // Deli meats
      "ham", "turkey breast", "roast beef", "pastrami", "salami", "pepperoni",
      "prosciutto", "pancetta", "bacon", "sausage", "chorizo",
      "deli meat", "lunch meat", "cold cuts",
      // Cheeses
      "cheese", "cheddar", "mozzarella", "parmesan", "swiss", "provolone",
      "gouda", "brie", "camembert", "feta", "goat cheese", "blue cheese",
      "cream cheese", "ricotta", "cottage cheese", "mascarpone",
      "american cheese", "pepper jack", "monterey jack", "colby",
    ]
  },
  bakery: {
    order: 3,
    name: "Bakery",
    keywords: [
      "bread", "loaf", "baguette", "ciabatta", "sourdough", "focaccia",
      "rolls", "dinner rolls", "hamburger buns", "hot dog buns",
      "tortilla", "tortillas", "wrap", "wraps", "pita", "naan", "flatbread",
      "croissant", "croissants", "bagel", "bagels", "english muffin", "english muffins",
      "breadcrumbs", "panko", "croutons",
    ]
  },
  pantry: {
    order: 4,
    name: "Pantry",
    keywords: [
      // Canned goods
      "canned", "can of", "diced tomatoes", "crushed tomatoes", "tomato paste", "tomato sauce",
      "beans", "black beans", "kidney beans", "chickpeas", "lentils",
      "corn", "peas", "green beans",
      // Pasta & grains
      "pasta", "spaghetti", "penne", "rigatoni", "fettuccine", "linguine", "macaroni",
      "rice", "brown rice", "white rice", "jasmine rice", "basmati", "arborio",
      "quinoa", "couscous", "orzo", "farro", "barley", "oats", "oatmeal",
      // Sauces & condiments
      "sauce", "marinara", "alfredo", "pesto", "salsa",
      "ketchup", "mustard", "mayonnaise", "mayo", "relish",
      "soy sauce", "teriyaki", "hoisin", "fish sauce", "oyster sauce",
      "vinegar", "balsamic", "red wine vinegar", "white wine vinegar", "rice vinegar",
      "olive oil", "vegetable oil", "canola oil", "sesame oil", "coconut oil",
      // Baking
      "flour", "sugar", "brown sugar", "powdered sugar", "baking powder", "baking soda",
      "yeast", "cornstarch", "vanilla", "vanilla extract", "cocoa", "chocolate chips",
      // Spices & seasonings
      "salt", "pepper", "cumin", "paprika", "chili powder", "cayenne",
      "cinnamon", "nutmeg", "ginger powder", "turmeric", "curry powder",
      "garlic powder", "onion powder", "italian seasoning", "herbs de provence",
      "bay leaf", "bay leaves",
      // Nuts & dried
      "almonds", "walnuts", "pecans", "cashews", "peanuts", "pine nuts",
      "raisins", "dried cranberries", "dates", "dried apricots",
      // Stocks & broths
      "broth", "stock", "chicken broth", "beef broth", "vegetable broth",
      "bouillon", "chicken stock", "beef stock",
      // Other pantry staples
      "honey", "maple syrup", "molasses", "agave",
      "peanut butter", "almond butter", "tahini",
      "coconut milk", "evaporated milk", "condensed milk",
    ]
  },
  misc: {
    order: 5,
    name: "Miscellaneous",
    keywords: [] // Fallback category - no keywords needed
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Determine the shopping category for an ingredient.
 * Uses word boundary matching to avoid partial matches.
 * Ported from app.py:149-180
 *
 * @param itemName - The ingredient name to categorize
 * @param overrideCategory - Optional manual category override from recipe
 * @returns Tuple of [categoryKey, categoryOrder] for sorting
 */
export function categorizeIngredient(
  itemName: string,
  overrideCategory?: string | null
): [string, number] {
  // If there's a manual override, use it
  if (overrideCategory && overrideCategory in SHOPPING_CATEGORIES) {
    const cat = SHOPPING_CATEGORIES[overrideCategory]
    return [overrideCategory, cat.order]
  }

  const itemLower = itemName.toLowerCase().trim()

  // Check each category's keywords
  for (const [catKey, catData] of Object.entries(SHOPPING_CATEGORIES)) {
    if (catKey === "misc") continue // Skip misc, it's the fallback

    for (const keyword of catData.keywords) {
      // Use word boundary matching to avoid partial matches
      // e.g., "rice" shouldn't match "rice vinegar" for produce
      const pattern = new RegExp(`\\b${escapeRegex(keyword.toLowerCase())}\\b`)
      if (pattern.test(itemLower)) {
        return [catKey, catData.order]
      }
    }
  }

  // Default to miscellaneous
  return ["misc", SHOPPING_CATEGORIES.misc.order]
}

/**
 * Check if an ingredient matches any excluded keyword using word boundaries.
 * Ported from app.py:214-229
 *
 * Uses regex word boundaries to avoid false positives like:
 * - "rice" matching "rice vinegar" (now only matches standalone "rice")
 * - "oil" matching "foil" (now only matches "oil" as a word)
 *
 * Multi-word keywords like "garlic powder" match as a phrase.
 *
 * @param itemName - The ingredient name to check
 * @param excludedKeywords - List of keywords to exclude
 * @returns true if the ingredient matches any excluded keyword
 */
export function isExcludedIngredient(
  itemName: string,
  excludedKeywords: string[]
): boolean {
  const itemLower = itemName.toLowerCase()

  for (const keyword of excludedKeywords) {
    // Use word boundaries to match whole words only
    const pattern = new RegExp(`\\b${escapeRegex(keyword.toLowerCase())}\\b`)
    if (pattern.test(itemLower)) {
      return true
    }
  }

  return false
}

/**
 * Get all shopping categories for UI dropdown
 */
export function getShoppingCategories(): Array<{
  key: string
  name: string
  order: number
}> {
  return Object.entries(SHOPPING_CATEGORIES)
    .map(([key, data]) => ({
      key,
      name: data.name,
      order: data.order,
    }))
    .sort((a, b) => a.order - b.order)
}
