import type { Session } from "@supabase/supabase-js"

export async function syncServerSession(session: Session | null): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", {
      method: session ? "POST" : "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: session ? { "Content-Type": "application/json" } : undefined,
      body: session ? JSON.stringify({ accessToken: session.access_token }) : undefined,
    })
    return response.ok
  } catch {
    return false
  }
}
