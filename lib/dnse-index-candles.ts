import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { normalizeCandleBar, type CandleBar, type IndexChartSymbol } from "@/lib/index-candles"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const PUBLIC_CHART_BASE_URLS = [
  "https://api.dnse.com.vn/chart-api/v2/ohlcs",
  "https://services.entrade.com.vn/chart-api/v2/ohlcs",
] as const
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"
const PUBLIC_CHART_TIMEOUT_MS = 4_000
const OHLC_ATTEMPT_TIMEOUT_MS = 8_000
const HISTORY_LOOKBACK_DAYS = 14
const DEFAULT_MAX_POINTS = 2_600

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

async function publicChartGet(baseUrl: string, kind: string, params: Record<string, string | number>) {
  const url = new URL(`${baseUrl}/${kind}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://banggia.dnse.com.vn",
      Referer: "https://banggia.dnse.com.vn/",
      "User-Agent": "Mozilla/5.0 StockOS/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PUBLIC_CHART_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("DNSE chart API returned invalid JSON")
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function normalizeDnseChartHistory(raw: unknown): CandleBar[] {
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

function openApiAttemptFor(symbol: IndexChartSymbol, from: number, to: number): OhlcAttempt {
  const common = { resolution: "1", from, to }
  return symbol === "VNINDEX"
    ? { label: "openapi INDEX/symbol", params: { ...common, symbol, type: "INDEX" } }
    : { label: "openapi DERIVATIVE/symbol", params: { ...common, symbol, type: "DERIVATIVE" } }
}

function publicKindsFor(symbol: IndexChartSymbol) {
  return symbol === "VNINDEX" ? ["index", "stock"] : ["derivative"]
}

function trimHistory(bars: CandleBar[], from: number, to: number, maxPoints: number) {
  const filtered = bars.filter((bar) => bar.time >= from && bar.time <= to)
  const limit = Math.max(390, Math.min(maxPoints, 3_200))
  return filtered.slice(-limit)
}

export async function fetchDnseIndexCandleHistory(symbol: IndexChartSymbol, now = new Date(), maxPoints = DEFAULT_MAX_POINTS) {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60
  const failures: string[] = []
  const publicParams = { resolution: "1", symbol, from, to }

  const publicAttempts = PUBLIC_CHART_BASE_URLS.flatMap((baseUrl) =>
    publicKindsFor(symbol).map((kind) => ({ baseUrl, kind, label: `${new URL(baseUrl).hostname} ${kind}` })),
  )
  const publicResults = await Promise.allSettled(publicAttempts.map(async (attempt) => {
    try {
      return {
        attempt,
        bars: trimHistory(
          normalizeDnseChartHistory(await publicChartGet(attempt.baseUrl, attempt.kind, publicParams)),
          from,
          to,
          maxPoints,
        ),
      }
    } catch (error) {
      throw new Error(`${attempt.label}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }))
  for (const result of publicResults) {
    if (result.status === "fulfilled" && result.value.bars.length) {
      const { bars, attempt } = result.value
      return {
        symbol,
        bars,
        sessionDate: vietnamDateKey(bars[bars.length - 1].time),
        transport: attempt.label,
      }
    }
    if (result.status === "fulfilled") {
      failures.push(`${result.value.attempt.label}: empty`)
    } else {
      failures.push(result.reason instanceof Error ? result.reason.message : "DNSE public chart failed")
    }
  }

  const attempt = openApiAttemptFor(symbol, from, to)
  try {
    const bars = trimHistory(normalizeDnseChartHistory(await signedGet(attempt.params)), from, to, maxPoints)
    if (bars.length) {
      return {
        symbol,
        bars,
        sessionDate: vietnamDateKey(bars[bars.length - 1].time),
        transport: attempt.label,
      }
    }
    failures.push(`${attempt.label}: empty`)
  } catch (error) {
    failures.push(`${attempt.label}: ${error instanceof Error ? error.message : "failed"}`)
  }

  throw new Error(`DNSE OHLC unavailable for ${symbol} (${failures.join("; ")})`)
}
