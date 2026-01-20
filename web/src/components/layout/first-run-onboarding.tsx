"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  ChefHat,
  Calendar,
  ShoppingCart,
  ArrowRight,
  Check,
} from "lucide-react"
import { useUpdateUserConfig } from "@/hooks/use-planner"

const ONBOARDING_SEEN_KEY = "recipe-genie-onboarding-seen"

// Hook to check and manage onboarding state
export function useFirstRunOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_SEEN_KEY)
    if (!seen) {
      setShowOnboarding(true)
    }
  }, [])

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "true")
    setShowOnboarding(false)
  }

  return { showOnboarding, completeOnboarding }
}

interface FirstRunOnboardingProps {
  open: boolean
  onComplete: () => void
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
]

export function FirstRunOnboarding({ open, onComplete }: FirstRunOnboardingProps) {
  const [step, setStep] = useState(0)
  const [selectedDay, setSelectedDay] = useState(1) // Monday default

  const updateConfig = useUpdateUserConfig()

  const handleComplete = async () => {
    try {
      await updateConfig.mutateAsync({
        week_start_day: selectedDay,
      })
      onComplete()
    } catch (error) {
      console.error("Failed to save config:", error)
      onComplete() // Still close on error
    }
  }

  const steps = [
    // Step 0: Welcome
    {
      title: "Welcome to Recipe Genie",
      content: (
        <div className="space-y-6">
          <div className="flex justify-center gap-6 py-6">
            <div className="flex flex-col items-center gap-2 animate-fade-in" style={{ animationDelay: "0ms" }}>
              <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                <ChefHat className="h-8 w-8 text-orange-600" />
              </div>
              <span className="text-sm font-medium">Recipes</span>
            </div>
            <div className="flex flex-col items-center gap-2 animate-fade-in" style={{ animationDelay: "100ms" }}>
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
                <Calendar className="h-8 w-8 text-blue-600" />
              </div>
              <span className="text-sm font-medium">Plan</span>
            </div>
            <div className="flex flex-col items-center gap-2 animate-fade-in" style={{ animationDelay: "200ms" }}>
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <ShoppingCart className="h-8 w-8 text-green-600" />
              </div>
              <span className="text-sm font-medium">Shop</span>
            </div>
          </div>

          <p className="text-center text-muted-foreground">
            Organize your recipes, plan your meals, and generate smart shopping lists automatically.
          </p>

          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">Typical workflow:</span>
              <span>Add Recipes</span>
              <ArrowRight className="h-4 w-4" />
              <span>Generate Plan</span>
              <ArrowRight className="h-4 w-4" />
              <span>Shop</span>
            </div>
          </div>
        </div>
      ),
    },
    // Step 1: Week Start Day
    {
      title: "When does your week start?",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-center">
            Choose which day your meal planning week begins.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.value}
                onClick={() => setSelectedDay(day.value)}
                className={`
                  flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all
                  ${selectedDay === day.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                  }
                `}
              >
                <span className="font-medium">{day.label}</span>
                {selectedDay === day.value && (
                  <Check className="h-5 w-5 text-primary" />
                )}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            You can change this later in settings.
          </p>
        </div>
      ),
    },
  ]

  const currentStep = steps[step]
  const isLastStep = step === steps.length - 1

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" hideCloseButton>
        {/* Progress Indicator */}
        <div className="flex gap-2 justify-center mb-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? "w-8 bg-primary" : "w-2 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="text-center mb-6">
          <h2 className="text-xl font-semibold">{currentStep.title}</h2>
        </div>

        {currentStep.content}

        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              className="flex-1"
            >
              Back
            </Button>
          )}
          <Button
            onClick={isLastStep ? handleComplete : () => setStep(step + 1)}
            disabled={updateConfig.isPending}
            className="flex-1"
          >
            {isLastStep
              ? updateConfig.isPending
                ? "Saving..."
                : "Get Started"
              : "Continue"
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
