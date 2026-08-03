import { MealPlanner } from "@/components/planner"
import { parsePlannerWeekParam } from "@/lib/planner-route-state"

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>
}) {
  const params = await searchParams
  const routeWeek = parsePlannerWeekParam(params.week)

  return (
    <div data-app-screen="planner">
      <MealPlanner routeWeek={routeWeek} />
    </div>
  )
}
