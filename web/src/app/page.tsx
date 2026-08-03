import { redirect } from "next/navigation"
import {
  buildRootDestination,
  type RootSearchParams,
} from "@/lib/root-route"

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RootSearchParams>
}) {
  redirect(buildRootDestination(await searchParams))
}
