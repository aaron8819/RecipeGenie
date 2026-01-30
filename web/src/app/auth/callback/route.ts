import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Allowed redirect paths (must start with these)
const ALLOWED_REDIRECT_PATHS = ["/", "/recipes", "/planner", "/shopping", "/pantry"]

/**
 * Validate that the redirect path is safe (not an open redirect)
 */
function validateRedirectPath(path: string): string {
  // Default to home if no path provided
  if (!path) return "/"
  
  // Must start with / (relative path)
  if (!path.startsWith("/")) return "/"
  
  // Must not be a protocol-relative URL (//evil.com)
  if (path.startsWith("//")) return "/"
  
  // Check against allowed paths
  const isAllowed = ALLOWED_REDIRECT_PATHS.some(
    allowed => path === allowed || path.startsWith(allowed + "/") || path.startsWith(allowed + "?")
  )
  
  return isAllowed ? path : "/"
}

/**
 * Map internal error codes to user-friendly messages
 * This prevents exposing internal error details in URLs
 */
function getErrorInfo(error: { message?: string; status?: number } | null): { code: string; description: string } {
  if (!error) {
    return { code: "unknown", description: "An unexpected error occurred" }
  }

  const message = error.message?.toLowerCase() || ""
  
  if (message.includes("pkce") || message.includes("code verifier")) {
    return {
      code: "pkce_code_verifier_not_found",
      description: "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
    }
  }
  
  if (message.includes("expired") || message.includes("invalid")) {
    return {
      code: "link_expired",
      description: "This confirmation link has expired or is invalid. Please request a new one."
    }
  }
  
  if (message.includes("already") && message.includes("confirmed")) {
    return {
      code: "already_confirmed",
      description: "Your email is already confirmed. Please sign in."
    }
  }
  
  // Default - don't expose internal error details
  return {
    code: "auth_error",
    description: "Authentication failed. Please try signing in again."
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorCode = requestUrl.searchParams.get("error_code")
  const errorDescription = requestUrl.searchParams.get("error_description")
  const next = validateRedirectPath(requestUrl.searchParams.get("next") ?? "/")

  // If there's an error parameter from OAuth, handle it
  if (error) {
    // Log the error for debugging (server-side only)
    console.error("[Auth Callback] OAuth error:", {
      error,
      errorCode,
      // Only log first 100 chars to avoid logging sensitive data
      errorDescription: errorDescription?.substring(0, 100),
      timestamp: new Date().toISOString(),
    })
    
    const redirectUrl = new URL("/", requestUrl.origin)
    redirectUrl.searchParams.set("error", error)
    if (errorCode) redirectUrl.searchParams.set("error_code", errorCode)
    // Use sanitized description for common errors
    const safeDescription = errorCode === "access_denied" 
      ? "Access was denied. Please try again."
      : (errorDescription?.substring(0, 200) || "Authentication failed")
    redirectUrl.searchParams.set("error_description", safeDescription)
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
      // Log the error for debugging (server-side only)
      console.error("[Auth Callback] Code exchange failed:", {
        errorStatus: exchangeError?.status,
        // Don't log full message - could contain sensitive info
        errorType: exchangeError?.message?.includes("PKCE") ? "PKCE" : "other",
        timestamp: new Date().toISOString(),
      })
      
      // Get sanitized error info
      const errorInfo = getErrorInfo(exchangeError)
      
      const redirectUrl = new URL("/", requestUrl.origin)
      redirectUrl.searchParams.set("error", "auth_failed")
      redirectUrl.searchParams.set("error_code", errorInfo.code)
      redirectUrl.searchParams.set("error_description", errorInfo.description)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // If there's no code and no error, redirect to home
  return NextResponse.redirect(new URL("/", requestUrl.origin))
}
