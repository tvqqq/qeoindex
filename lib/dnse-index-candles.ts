import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { normalizeCandleBar, type CandleBar, type IndexChartSymbol } from "@/lib/index-candles"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"
const OHLC_ATTEMPT_TIMEOUT_MS = 2_500

function credentials() {
  const apiKey = process.env.DNSE_API_KEY ?? ""
  const apiSecret = process.env.DNSE_API_SECRET ?? ""
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")
  return { apiKey, apiSecret }
}

function formatDateHeader(date: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function signatureHeaders(method: string, path: string, apiKey: string, apiSecret: string) {
  const dateValue = formatDateHeader(new Date())
  const nonce = randomUUID().replaceAll("-", "")
  const signingString = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${dateValue}\nnonce: ${nonce}`
  const raw = createHmac("sha256", Buffer.from(apiSecret, "utf8")).update(signingString, "utf8").digest("base64")
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${encodeURIComponent(raw)}",nonce="${nonce}"`,
    "x-api-key": apiKey,
  }
}

async function signedGet(params: Record<string, string | number>) {
  const { apiKey, apiSecret } = credentials()
  const path = "/price/ohlc"
  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
    signal: AbortSignal.timeout(OHLC_ATTEMPT_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("DNSE OHLC returned invalid JSON")
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeOhlcv(raw: unknown): CandleBar[] {
  const payload = raw as Record<string, unknown> | null
  const source = (payload?.data ?? payload?.result ?? payload) as Record<string, unknown> | unknown[] | null
  let rows: unknown[] = []

  if (Array.isArray(source)) {
    rows = source
  } else if (source && typeof source === "object") {
    const times = array(source.t ?? source.time ?? source.timestamps)
    const opens = array(source.o ?? source.open)
    const highs = array(source.h ?? source.high)
    const lows = array(source.l ?? source.low)
    const closes = array(source.c ?? source.close)
    const volumes = array(source.v ?? source.volume ?? source.vol)
    const length = Math.min(times.length, opens.length, highs.length, lows.length, closes.length)
    rows = Array.from({ length }, (_, index) => ({
      time: times[index],
      open: opens[index],
      high: highs[index],
      low: lows[index],
      close: closes[index],
      volume: volumes[index] ?? 0,
    }))
  }

  const byTime = new Map<number, CandleBar>()
  for (const row of rows) {
    const bar = normalizeCandleBar(row)
    if (bar) byTime.set(bar.time, bar)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

function vietnamDateKey(timestampSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampSeconds * 1000))
}

type OhlcAttempt = { label: string; params: Record<string, string | number> }

function attemptsFor(symbol: IndexChartSymbol, from: number, to: number): OhlcAttempt[] {
  const common = { resolution: "1", from, to }
  if (symbol === "VNINDEX") {
    return [
      { label: "INDEX/symbol", params: { ...common, symbol, type: "INDEX" } },
      { label: "STOCK/symbol", params: { ...common, symbol, type: "STOCK" } },
    ]
  }
  return [
    { label: "DERIVATIVE/symbol", params: { ...common, symbol, type: "DERIVATIVE" } },
    { label: "DERIVATIVE/symbolType", params: { ...common, symbolType: symbol, type: "DERIVATIVE" } },
    { label: "STOCK/symbol", params: { ...common, symbol, type: "STOCK" } },
  ]
}

export async function fetchDnseIndexCandleHistory(symbol: IndexChartSymbol, now = new Date(), maxPoints = 390) {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - 8 * 24 * 60 * 60
  const failures: string[] = []

  for (const attempt of attemptsFor(symbol, from, to)) {
    try {
      const bars = normalizeOhlcv(await signedGet(attempt.params))
      if (!bars.length) {
        failures.push(`${attempt.label}: empty`)
        continue
      }
      const latestSession = vietnamDateKey(bars[bars.length - 1].time)
      const sessionBars = bars.filter((bar) => vietnamDateKey(bar.time) === latestSession)
      if (!sessionBars.length) {
        failures.push(`${attempt.label}: no session bars`)
        continue
      }
      return {
        symbol,
        bars: sessionBars.slice(-Math.max(30, Math.min(maxPoints, 480))),
        sessionDate: latestSession,
        transport: attempt.label,
      }
    } catch (error) {
      failures.push(`${attempt.label}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }

  throw new Error(`DNSE OHLC unavailable for ${symbol} (${failures.join("; ")})`)
}
