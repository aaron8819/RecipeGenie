import { Loader2 } from "lucide-react"

export default function RecipeLoading() {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center bg-background"
      aria-label="Loading recipe"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
}
