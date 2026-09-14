"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseBrowserClient } from "@/modules/shared/supabase/client"

export async function getAuthenticatedSupabaseRealtimeClient(): Promise<SupabaseClient> {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error("Supabase browser client is not configured.")

  const { data, error } = await supabase.auth.getSession()
  const session = data.session
  if (error) throw new Error(`Supabase auth session failed: ${error.message}`)
  if (!session?.access_token) throw new Error("Supabase auth session is unavailable.")

  await supabase.realtime.setAuth(session.access_token)
  return supabase
}
