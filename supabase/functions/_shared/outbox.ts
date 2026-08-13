export const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
export const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
}

export function authorize(request: Request) {
  const secret = Deno.env.get("OUTBOX_DISPATCH_SECRET") ?? ""
  return secret.length >= 24 && request.headers.get("authorization") === `Bearer ${secret}`
}

export async function db(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service environment is unavailable")
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=representation", ...init.headers },
  })
  const body = await result.text()
  if (!result.ok) throw new Error(`Database request failed (${result.status}): ${body.slice(0, 240)}`)
  return body ? JSON.parse(body) : null
}

export function retryPatch(attemptCount: number, error: unknown) {
  const dead = attemptCount >= 5
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1))
  return {
    status: dead ? "dead" : "failed",
    last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
  }
}
