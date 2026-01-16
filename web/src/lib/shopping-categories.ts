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
      "muffin", "muffins", "scone", "scones", "danish", "pastry", "pastries",
    ]
  },
  protein: {
    order: 4,
    name: "Protein",
    keywords: [
      // Poultry
      "chicken", "chicken breast", "chicken thigh", "chicken thighs", "chicken wings",
      "chicken drumsticks", "whole chicken", "ground chicken",
      "turkey", "ground turkey", "turkey breast",
      "duck", "cornish hen",
      // Beef
      "beef", "ground beef", "steak", "sirloin", "ribeye", "filet mignon", "flank steak",
      "skirt steak", "chuck roast", "brisket", "short ribs", "beef ribs",
      // Pork
      "pork", "pork chop", "pork chops", "pork loin", "pork tenderloin",
      "ground pork", "pork shoulder", "pork belly", "ribs", "spare ribs",
      // Lamb & other
      "lamb", "lamb chop", "lamb chops", "ground lamb", "lamb shank", "leg of lamb",
      "veal", "venison", "bison", "goat",
      // Seafood
      "fish", "salmon", "tuna", "cod", "tilapia", "halibut", "mahi mahi", "sea bass",
      "trout", "snapper", "swordfish", "catfish", "sardines", "anchovies",
      "shrimp", "prawns", "lobster", "crab", "crab meat", "scallops",
      "mussels", "clams", "oysters", "calamari", "squid", "octopus",
    ]
  },
  dairy: {
    order: 5,
    name: "Dairy",
    keywords: [
      // Milk & cream
      "milk", "whole milk", "skim milk", "2% milk", "half and half", "heavy cream",
      "whipping cream", "sour cream", "buttermilk",
      // Eggs
      "egg", "eggs",
      // Butter & spreads
      "butter", "unsalted butter", "salted butter", "margarine",
      // Yogurt
      "yogurt", "greek yogurt", "plain yogurt", "vanilla yogurt",
      // Other dairy
      "kefir", "creme fraiche",
    ]
  },
  pantry: {
    order: 6,
    name: "Pantry",
    keywords: [
      // Canned goods
      "canned", "can of", "diced tomatoes", "crushed tomatoes", "tomato paste", "tomato sauce",
      "sun dried tomatoes", "sun-dried tomatoes", "sundried tomatoes",
      "beans", "black beans", "kidney beans", "chickpeas", "lentils",
      // Pasta & grains
      "pasta", "spaghetti", "penne", "rigatoni", "fettuccine", "linguine", "macaroni",
      "rice", "brown rice", "white rice", "jasmine rice", "basmati", "arborio",
      "quinoa", "couscous", "orzo", "farro", "barley", "oats", "oatmeal",
      // Breading & chips
      "breadcrumbs", "panko", "croutons",
      "tortilla chips", "chips", "crackers",
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
  frozen: {
    order: 7,
    name: "Frozen",
    keywords: [
      "frozen", "ice cream", "frozen pizza", "frozen vegetables", "frozen fruit",
      "frozen berries", "frozen peas", "frozen corn", "frozen spinach",
      "frozen yogurt", "popsicle", "popsicles", "ice pops",
      "frozen waffles", "frozen pancakes", "frozen fries", "french fries",
      "tater tots", "frozen fish", "fish sticks", "frozen shrimp",
      "frozen chicken", "frozen dinner", "tv dinner",
    ]
  },
  misc: {
    order: 8,
    name: "Miscellaneous",
    keywords: [
      // Non-food items only
      // Kitchen supplies
      "tinfoil", "tin foil", "aluminum foil", "foil", "plastic wrap", "saran wrap",
      "cling wrap", "parchment paper", "wax paper", "paper towels", "paper towel",
      "napkins", "napkin", "paper plates", "plastic plates", "plastic cups",
      "plastic utensils", "disposable", "ziplock", "zip lock", "storage bags",
      "freezer bags", "sandwich bags", "trash bags", "garbage bags",
      // Cleaning supplies
      "dish soap", "dishwasher detergent", "dishwasher pods", "sponge", "sponges",
      "scrub brush", "cleaning", "cleaner", "bleach", "disinfectant",
      "laundry detergent", "fabric softener", "dryer sheets",
      // Personal care
      "toilet paper", "tissues", "tissue", "toothpaste", "toothbrush",
      "shampoo", "conditioner", "soap", "hand soap", "body wash",
      // Pet supplies
      "dog food", "cat food", "pet food", "cat litter", "dog treats", "cat treats",
      // Other non-food
      "batteries", "light bulb", "light bulbs", "candles", "matches", "lighter",
    ]
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
 * Prioritizes longer keyword matches to handle cases like "sun dried tomatoes"
 * matching pantry instead of "tomatoes" matching produce.
 * 
 * Default behavior:
 * - Unknown food items → Pantry (catch-all for food)
 * - Non-food items → Miscellaneous (must match explicit keywords)
 * 
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

  // Build a list of all keyword matches with their category info
  // Sort by keyword length (longest first) to prioritize specific matches
  const allKeywords: Array<{ keyword: string; catKey: string; order: number }> = []
  
  for (const [catKey, catData] of Object.entries(SHOPPING_CATEGORIES)) {
    if (catKey === "misc") continue // Skip misc, it's the fallback
    
    for (const keyword of catData.keywords) {
      allKeywords.push({ keyword, catKey, order: catData.order })
    }
  }
  
  // Sort by keyword length descending so longer/more specific matches are checked first
  // e.g., "sun dried tomatoes" is checked before "tomatoes"
  allKeywords.sort((a, b) => b.keyword.length - a.keyword.length)
  
  for (const { keyword, catKey, order } of allKeywords) {
    // Use word boundary matching to avoid partial matches
    const pattern = new RegExp(`\\b${escapeRegex(keyword.toLowerCase())}\\b`)
    if (pattern.test(itemLower)) {
      return [catKey, order]
    }
  }

  // Default to pantry for unknown food items
  // (misc is reserved for non-food items which have explicit keywords)
  return ["pantry", SHOPPING_CATEGORIES.pantry.order]
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
