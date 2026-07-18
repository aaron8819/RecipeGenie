import { NextResponse } from "next/server"
import { getDeploymentManifest } from "@/lib/deployment-manifest"

export const dynamic = "force-static"

export function GET() {
  return NextResponse.json(getDeploymentManifest(), {
    headers: { "Cache-Control": "public, max-age=300, immutable" },
  })
}
