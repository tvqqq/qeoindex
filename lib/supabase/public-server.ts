import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let publicServerClient: SupabaseClient | null = null

/**
 * Least-privilege server client for public read models.
 * It uses the publishable/anon key so RLS remains the authorization boundary.
 * Never use the service-role client for public page reads just to bypass policy.
 */
export function getSupabasePublicServerClient(): SupabaseClient | null {
  if (publicServerClient) return publicServerClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  publicServerClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return publicServerClient
}
