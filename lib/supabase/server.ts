import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let serverClient: SupabaseClient | null = null

/**
 * Trusted infrastructure client for server-side snapshot ingestion/cache access.
 * User-owned data must use the user-scoped client from modules/auth/server so RLS
 * continues to enforce auth.uid(). This client intentionally fails closed when
 * the service-role credential is unavailable.
 */
export function getSupabaseServerClient(): SupabaseClient | null {
  if (serverClient) return serverClient

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) return null

  serverClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return serverClient
}
