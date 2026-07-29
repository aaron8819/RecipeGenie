import { Loader2 } from "lucide-react"

export default function RecipeLoading() {
  return (
    <main
      className="flex min-h-0 flex-1 items-center justify-center bg-background"
      aria-label="Loading recipe"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </main>
  )
}
