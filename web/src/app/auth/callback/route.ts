import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorCode = requestUrl.searchParams.get("error_code")
  const errorDescription = requestUrl.searchParams.get("error_description")
  const next = requestUrl.searchParams.get("next") ?? "/"

  // If there's an error parameter, pass it through to the home page
  if (error) {
    const redirectUrl = new URL("/", requestUrl.origin)
    redirectUrl.searchParams.set("error", error)
    if (errorCode) redirectUrl.searchParams.set("error_code", errorCode)
    if (errorDescription) redirectUrl.searchParams.set("error_description", errorDescription)
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!exchangeError) {
      // Redirect to the app after successful confirmation
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    } else {
      // If exchange failed, redirect with error
      const redirectUrl = new URL("/", requestUrl.origin)
      redirectUrl.searchParams.set("error", "access_denied")
      redirectUrl.searchParams.set("error_code", exchangeError.status?.toString() || "unknown")
      redirectUrl.searchParams.set("error_description", exchangeError.message || "Failed to confirm email")
      return NextResponse.redirect(redirectUrl)
    }
  }

  // If there's no code and no error, redirect to home
  return NextResponse.redirect(new URL("/", requestUrl.origin))
}
