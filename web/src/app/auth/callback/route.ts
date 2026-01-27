import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

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
    
    // Exchange the code for a session
    // For email confirmation, Supabase handles PKCE automatically if the code verifier
    // is in cookies. If not found, it will return an error which we'll handle.
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!exchangeError && data.session) {
      // Successfully confirmed and created session
      // Redirect to the app after successful confirmation
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    } else {
      // If exchange failed, check if it's a PKCE error
      const isPKCEError = exchangeError?.message?.includes("PKCE") || 
                          exchangeError?.message?.includes("code verifier")
      
      if (isPKCEError) {
        // PKCE error - redirect to home with a helpful message
        // The user can try signing in directly since their email might already be confirmed
        const redirectUrl = new URL("/", requestUrl.origin)
        redirectUrl.searchParams.set("error", "pkce_error")
        redirectUrl.searchParams.set("error_code", "pkce_code_verifier_not_found")
        redirectUrl.searchParams.set("error_description", "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed.")
        return NextResponse.redirect(redirectUrl)
      } else {
        // Other error - redirect with error details
        const redirectUrl = new URL("/", requestUrl.origin)
        redirectUrl.searchParams.set("error", "access_denied")
        redirectUrl.searchParams.set("error_code", exchangeError?.status?.toString() || "unknown")
        redirectUrl.searchParams.set("error_description", exchangeError?.message || "Failed to confirm email")
        return NextResponse.redirect(redirectUrl)
      }
    }
  }

  // If there's no code and no error, redirect to home
  return NextResponse.redirect(new URL("/", requestUrl.origin))
}
