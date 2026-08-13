import "server-only"

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured server-side")
  return { url, key }
}

export async function supabaseAdminRead<T>(path: string): Promise<T> {
  const { url, key } = configuration()
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" })
  const body = await response.text()
  if (!response.ok) throw new Error(`Supabase operational read failed (${response.status}): ${body.slice(0, 240)}`)
  return JSON.parse(body) as T
}

export function supabaseServerConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
