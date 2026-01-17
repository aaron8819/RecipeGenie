"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  HelpCircle,
  ChefHat,
  Calendar,
  ShoppingCart,
  Package,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
} from "lucide-react"

interface OnboardingDialogProps {
  trigger?: React.ReactNode
}

export function OnboardingDialog({ trigger }: OnboardingDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="h-5 w-5" />
            <span className="sr-only">Help</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ChefHat className="h-7 w-7 text-primary" />
            Welcome to Recipe Genie
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Introduction */}
          <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
            <p className="text-muted-foreground leading-relaxed">
              Recipe Genie helps you plan meals, organize recipes, and generate
              smart shopping lists. Here's how to get the most out of it!
            </p>
          </div>

          {/* Recipes Section */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-100 text-orange-600">
                <ChefHat className="h-4 w-4" />
              </div>
              Recipes
            </h3>
            <div className="pl-10 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Browse & Search:</strong>{" "}
                View all your recipes organized by category. Use the search bar
                to find specific dishes.
              </p>
              <p>
                <strong className="text-foreground">Add Recipes:</strong> Tap
                the + button to add new recipes with ingredients and
                instructions.
              </p>
              <p>
                <strong className="text-foreground">Favorites:</strong> Star
                your favorite recipes for quick access.
              </p>
              <p>
                <strong className="text-foreground">Add to Plan:</strong> Tap
                the calendar icon on any recipe to add it to a specific week's
                meal plan.
              </p>
            </div>
          </section>

          {/* Planner Section */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 text-blue-600">
                <Calendar className="h-4 w-4" />
              </div>
              Meal Planner
            </h3>
            <div className="pl-10 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Generate Plans:</strong>{" "}
                Select how many recipes you want from each category and tap
                "Generate" for automatic meal planning.
              </p>
              <p className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span>
                  The planner avoids recipes you've made recently for variety!
                </span>
              </p>
              <p>
                <strong className="text-foreground">Swap Recipes:</strong>{" "}
                Don't like a suggestion? Use the{" "}
                <RefreshCw className="inline h-3 w-3" /> swap button to get
                another option.
              </p>
              <p>
                <strong className="text-foreground">Mark as Made:</strong> Check
                off recipes as you cook them to track your history.
              </p>
              <p>
                <strong className="text-foreground">Navigate Weeks:</strong> Use
                the arrows to view past or future weeks.
              </p>
            </div>
          </section>

          {/* Shopping List Section */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-100 text-green-600">
                <ShoppingCart className="h-4 w-4" />
              </div>
              Shopping List
            </h3>
            <div className="pl-10 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Generate from Plan:</strong>{" "}
                In the Planner tab, tap "Add to Shopping List" to automatically
                combine ingredients from your meal plan.
              </p>
              <p>
                <strong className="text-foreground">Smart Organization:</strong>{" "}
                Items are grouped by store section (Produce, Dairy, Meat, etc.)
                for efficient shopping.
              </p>
              <p>
                <strong className="text-foreground">Check Off Items:</strong>{" "}
                Tap items to mark them as purchased. They'll move to "Already
                Have."
              </p>
              <p>
                <strong className="text-foreground">Manual Items:</strong> Add
                items that aren't from recipes using the + button.
              </p>
            </div>
          </section>

          {/* Pantry Section */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 text-purple-600">
                <Package className="h-4 w-4" />
              </div>
              Pantry
            </h3>
            <div className="pl-10 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Track Staples:</strong> Add
                items you always have on hand (salt, oil, spices, etc.)
              </p>
              <p>
                <strong className="text-foreground">Auto-Exclude:</strong>{" "}
                Pantry items are automatically excluded from shopping lists!
              </p>
              <p>
                <strong className="text-foreground">Excluded Keywords:</strong>{" "}
                Add keywords (like "water") to always exclude from lists.
              </p>
            </div>
          </section>

          {/* Quick Tips */}
          <section className="bg-muted/50 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Quick Tips
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>
                  The app learns your shopping preferences and remembers item
                  categories.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>
                  Ingredient amounts are automatically combined when the same
                  item appears in multiple recipes.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>
                  Long-press or drag items in the shopping list to reorder them.
                </span>
              </li>
            </ul>
          </section>

          {/* Workflow Arrow */}
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <span className="font-medium">Typical workflow:</span>
            <span>Recipes</span>
            <ArrowRight className="h-4 w-4" />
            <span>Planner</span>
            <ArrowRight className="h-4 w-4" />
            <span>Shopping</span>
            <ArrowRight className="h-4 w-4" />
            <span>Cook!</span>
          </div>
        </div>

        <div className="pt-4 border-t">
          <Button onClick={() => setOpen(false)} className="w-full">
            Got it, let's cook!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
