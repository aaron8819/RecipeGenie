"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { Loader2, ChefHat, UserCircle } from "lucide-react"

interface AuthFormProps {
  onGuestMode?: () => void
}

export function AuthForm({ onGuestMode }: AuthFormProps) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { signIn, signUp } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setLoading(true)

    try {
      if (isSignUp) {
        await signUp(email, password)
        setSuccessMessage("Check your email for a confirmation link!")
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setLoading(false)
    }
  }

  const handleGuestMode = () => {
    if (onGuestMode) {
      onGuestMode()
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto animate-fade-in">
      <CardContent className="p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <ChefHat className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Recipe Genie</h1>
          <p className="text-muted-foreground">
            {isSignUp ? "Create an account" : "Sign in to your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="text-sm text-sage-700 bg-sage-100 p-3 rounded-lg">
              {successMessage}
            </div>
          )}

          <Button type="submit" className="w-full h-11" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSignUp ? "Sign Up" : "Sign In"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp)
              setError(null)
              setSuccessMessage(null)
            }}
            className="text-sm text-primary hover:underline transition-colors"
          >
            {isSignUp
              ? "Already have an account? Sign in"
              : "Don't have an account? Sign up"}
          </button>
        </div>

        {/* Guest Mode Button */}
        <div className="mt-6 pt-6 border-t border-border">
          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            onClick={handleGuestMode}
          >
            <UserCircle className="mr-2 h-4 w-4" />
            Try as Guest
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Explore the app without signing up. Your data will be saved locally in this browser.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
