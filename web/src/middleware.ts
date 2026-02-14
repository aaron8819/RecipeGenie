import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: "",
            ...options,
          })
        },
      },
    }
  )

  // Refresh session if expired
  await supabase.auth.getUser()

  // Add security headers
  const headers = new Headers(response.headers);

  // Generate nonce for CSP using Web Crypto API (Edge Runtime compatible)
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  const isDev = process.env.NODE_ENV === 'development';

  // Content Security Policy with nonce-based script execution
  // Nonce allows only scripts with matching nonce attribute, blocking XSS
  // Next.js 15+ automatically detects the nonce and applies it to inline scripts
  const csp = [
    "default-src 'self'",
    // Use nonce instead of 'unsafe-inline' for better XSS protection
    // 'unsafe-eval' still required for Next.js hydration/React
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'", // Required for Radix UI + Tailwind
    "img-src 'self' data: https: blob:", // Allow HTTPS images from any domain for recipe URLs
    "font-src 'self' data:",
    // In dev: allow localhost for HMR WebSocket
    isDev
      ? "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws://localhost:* http://localhost:*"
      : "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ');

  headers.set('Content-Security-Policy', csp);
  headers.set('X-Nonce', nonce); // Make nonce available to layout for custom scripts
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS (only on HTTPS)
  if (request.nextUrl.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
