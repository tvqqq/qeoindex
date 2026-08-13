import type { OhlcvBar } from "../../../lib/technical-indicators.ts"

export const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
export const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const DATABASE_TIMEOUT_MS = 10_000
const PROVIDER_TIMEOUT_MS = 8_000

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
}

export function authorized(request: Request) {
  const secret = Deno.env.get("SCANNER_RUN_SECRET") ?? ""
  return secret.length >= 24 && request.headers.get("authorization") === `Bearer ${secret}`
}

export async function db(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service environment is unavailable")
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=representation", ...init.headers },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body.slice(0, 300)}`)
  return body ? JSON.parse(body) : null
}

export function vietnamDateKey(timestampMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestampMs))
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function marketClosed(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  return hour > 15 || (hour === 15 && minute >= 30)
}

function normalize(source: unknown): OhlcvBar[] {
  const payload = source as Record<string, unknown>
  const data = (payload?.data ?? payload?.result ?? payload) as Record<string, unknown> | unknown[]
  if (Array.isArray(data)) return data.map((raw) => {
    const row = raw as Record<string, unknown>
    return { time: Number(row.time ?? row.t ?? row.timestamp), open: Number(row.open ?? row.o), high: Number(row.high ?? row.h), low: Number(row.low ?? row.l), close: Number(row.close ?? row.c), volume: Number(row.volume ?? row.v ?? 0) }
  }).filter((bar) => Object.values(bar).every(Number.isFinite)).sort((a, b) => a.time - b.time)
  const array = (key: string) => Array.isArray(data?.[key]) ? (data[key] as unknown[]).map(Number) : []
  const t = array("t").length ? array("t") : array("time")
  const o = array("o").length ? array("o") : array("open")
  const h = array("h").length ? array("h") : array("high")
  const l = array("l").length ? array("l") : array("low")
  const c = array("c").length ? array("c") : array("close")
  const v = array("v").length ? array("v") : array("volume")
  return Array.from({ length: Math.min(t.length, o.length, h.length, l.length, c.length) }, (_, index) => ({ time: t[index], open: o[index], high: h[index], low: l[index], close: c[index], volume: v[index] ?? 0 })).filter((bar) => Object.values(bar).every(Number.isFinite))
}

function dateHeader(date: Date) { return date.toUTCString().replace("GMT", "+0000") }
async function hmacBase64(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))
  return btoa(String.fromCharCode(...bytes))
}

let dnseUnavailableUntil = 0

async function dnseHistory(ticker: string, now: Date) {
  const apiKey = Deno.env.get("DNSE_API_KEY") ?? ""
  const apiSecret = Deno.env.get("DNSE_API_SECRET") ?? ""
  if (!apiKey || !apiSecret) throw new Error("DNSE credentials are not configured")
  const path = "/price/ohlc"
  const base = (Deno.env.get("DNSE_API_BASE_URL") ?? "https://openapi.dnse.com.vn").replace(/\/$/, "")
  const to = Math.floor(now.getTime() / 1000)
  const from = to - 620 * 86400
  const errors: string[] = []
  for (const resolution of ["1D", "D"]) {
    const url = new URL(`${base}${path}`)
    url.searchParams.set("symbol", ticker); url.searchParams.set("resolution", resolution); url.searchParams.set("from", String(from)); url.searchParams.set("to", String(to)); url.searchParams.set("type", "STOCK")
    const date = dateHeader(new Date()); const nonce = crypto.randomUUID().replaceAll("-", "")
    const signature = encodeURIComponent(await hmacBase64(apiSecret, `(request-target): get ${path}\ndate: ${date}\nnonce: ${nonce}`))
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), headers: { Date: date, "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}",nonce="${nonce}"`, "x-api-key": apiKey } })
      const body = await response.text()
      if (!response.ok) throw new Error(`DNSE ${resolution} failed (${response.status}): ${body.slice(0, 160)}`)
      const bars = normalize(JSON.parse(body))
      if (bars.length) return bars
      throw new Error(`DNSE ${resolution} returned no usable bars`)
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  }
  throw new Error(errors.join(" | "))
}

async function yahooHistory(ticker: string, now: Date) {
  const period2 = Math.floor(now.getTime() / 1000) + 86400
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${ticker}.VN`)}`)
  url.searchParams.set("period1", String(period2 - 620 * 86400)); url.searchParams.set("period2", String(period2)); url.searchParams.set("interval", "1d"); url.searchParams.set("events", "history")
  const response = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), headers: { Accept: "application/json", "User-Agent": "StockOS/1.0 supabase-scanner" } })
  const body = await response.text()
  if (!response.ok) throw new Error(`Yahoo failed (${response.status}): ${body.slice(0, 160)}`)
  const result = JSON.parse(body)?.chart?.result?.[0]
  if (!result) throw new Error("Yahoo returned no chart result")
  const quote = result.indicators?.quote?.[0] ?? {}
  const bars = (result.timestamp ?? []).map((time: unknown, index: number) => ({ time: Number(time), open: Number(quote.open?.[index]), high: Number(quote.high?.[index]), low: Number(quote.low?.[index]), close: Number(quote.close?.[index]), volume: Number(quote.volume?.[index] ?? 0) })).filter((bar: OhlcvBar) => Object.values(bar).every(Number.isFinite))
  if (!bars.length) throw new Error("Yahoo returned no usable bars")
  return bars
}

export async function fetchDailyHistory(ticker: string, now = new Date()) {
  const errors: string[] = []
  if (Date.now() >= dnseUnavailableUntil) {
    try {
      const bars = await dnseHistory(ticker, now)
      return { bars: completedBars(bars, now), provider: "DNSE" as const, detail: "DNSE OpenAPI · 1D", primaryError: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); errors.push(`DNSE: ${message}`)
      if (/fetch|network|timed|connect/i.test(message)) dnseUnavailableUntil = Date.now() + 5 * 60_000
    }
  } else errors.push("DNSE: circuit breaker active")
  try { return { bars: completedBars(await yahooHistory(ticker, now), now), provider: "Fallback" as const, detail: "Yahoo Finance .VN fallback · 1D", primaryError: errors.join(" | ").slice(0, 1000) } }
  catch (error) { errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`) }
  throw new Error(errors.join(" | ").slice(0, 1000))
}

function completedBars(bars: OhlcvBar[], now: Date) {
  if (marketClosed(now)) return bars
  const today = vietnamDateKey(now.getTime())
  return bars.filter((bar) => vietnamDateKey(bar.time * 1000) !== today)
}

export function retry(attempt: number, error: unknown) {
  return { status: attempt >= 5 ? "dead" : "failed", last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000), next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000).toISOString(), finished_at: attempt >= 5 ? new Date().toISOString() : null }
}
