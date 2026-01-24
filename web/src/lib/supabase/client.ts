import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/database"

// Singleton client instance for browser-side usage
let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null

/**
 * Get the Supabase browser client (singleton pattern).
 * Use this for all client-side Supabase operations.
 */
export function getSupabase() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return browserClient
}

// Backward compatibility alias
export const createClient = getSupabase
