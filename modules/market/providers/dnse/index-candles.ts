import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { buildDnseRequestWindows } from "@/modules/market/providers/dnse/request-windows"
import { raceHistoryTransports } from "@/modules/market/providers/dnse/history-race"
import {
  normalizeCandleBar,
  resampleCandleSeries,
  type CandleBar,
  type IndexChartResolution,
  type IndexChartSymbol,
} from "@/modules/market/realtime/index-candles"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const PUBLIC_CHART_BASE_URLS = [
  "https://api.dnse.com.vn/chart-api/v2/ohlcs",
  "https://services.entrade.com.vn/chart-api/v2/ohlcs",
] as const
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"
const PUBLIC_CHART_TIMEOUT_MS = 12_000
const OHLC_ATTEMPT_TIMEOUT_MS = 8_000
const SIGNED_HEDGE_DELAY_MS = 2_000

function dnseFailureCode(reason: unknown) {
  if (!(reason instanceof Error)) return "failed"
  const cause = (reason as Error & { cause?: unknown }).cause
  if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
    switch (cause.code) {
      case "EAI_AGAIN": return "dns_retry"
      case "ENOTFOUND": return "dns_not_found"
      case "ETIMEDOUT": return "network_timeout"
      case "UND_ERR_CONNECT_TIMEOUT": return "connect_timeout"
      case "ECONNRESET": return "connection_reset"
      case "ECONNREFUSED": return "connection_refused"
      case "ECONNABORTED": return "connection_aborted"
      case "EHOSTUNREACH": return "host_unreachable"
      case "ENETUNREACH": return "network_unreachable"
    }
  }
  if (reason.name === "TimeoutError" || /timed? ?out|timeout/i.test(reason.message)) return "timeout"
  if (reason.name === "AbortError") return "aborted"
  const status = reason.message.match(/^HTTP (\d{3})$/)
  if (status) return `http_${status[1]}`
  if (/invalid JSON/i.test(reason.message)) return "invalid_json"
  if (reason.message === "DNSE server credentials are not configured") return "credentials_unavailable"
  if (reason instanceof TypeError) return "network"
  return "failed"
}

type HistoryConfig = {
  sourceResolution: Exclude<IndexChartResolution, "4H">
  lookbackDays: number
  maxPoints: number
}

const HISTORY_CONFIG: Record<IndexChartResolution, HistoryConfig> = {
  "1": { sourceResolution: "1", lookbackDays: 14, maxPoints: 2_600 },
  "5": { sourceResolution: "5", lookbackDays: 75, maxPoints: 3_200 },
  "30": { sourceResolution: "30", lookbackDays: 300, maxPoints: 3_200 },
  "1H": { sourceResolution: "1H", lookbackDays: 540, maxPoints: 3_200 },
  "4H": { sourceResolution: "1H", lookbackDays: 900, maxPoints: 3_200 },
  "1D": { sourceResolution: "1D", lookbackDays: 1_825, maxPoints: 1_800 },
}

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

async function signedGet(params: Record<string, string | number>, cancellationSignal: AbortSignal) {
  const { apiKey, apiSecret } = credentials()
  const path = "/price/ohlc"
  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
    signal: AbortSignal.any([cancellationSignal, AbortSignal.timeout(OHLC_ATTEMPT_TIMEOUT_MS)]),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("DNSE OHLC returned invalid JSON")
  }
}

async function publicChartGet(baseUrl: string, kind: string, params: Record<string, string | number>, cancellationSignal: AbortSignal) {
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
    signal: AbortSignal.any([cancellationSignal, AbortSignal.timeout(PUBLIC_CHART_TIMEOUT_MS)]),
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

type OhlcAttempt = { label: string }
type SignedOhlcAttempt = OhlcAttempt & { params: Record<string, string | number> }
type OhlcWindow = { from: number; to: number }
type OhlcAttemptResult = { attempt: OhlcAttempt; bars: CandleBar[] }

function openApiAttemptFor(
  symbol: IndexChartSymbol,
  sourceResolution: string,
  from: number,
  to: number,
): SignedOhlcAttempt {
  const common = { resolution: sourceResolution, from, to }
  return symbol === "VNINDEX"
    ? { label: `openapi INDEX/symbol ${sourceResolution}`, params: { ...common, symbol, type: "INDEX" } }
    : { label: `openapi DERIVATIVE/symbol ${sourceResolution}`, params: { ...common, symbol, type: "DERIVATIVE" } }
}

async function runOhlcAttempt(
  symbol: IndexChartSymbol,
  resolution: IndexChartResolution,
  limit: number,
  from: number,
  to: number,
  windows: OhlcWindow[],
  attempt: OhlcAttempt,
  loadWindow: (window: OhlcWindow) => Promise<CandleBar[]>,
): Promise<OhlcAttemptResult> {
  const segments = await Promise.allSettled(windows.map(loadWindow))
  const bars = finalizeHistory(
    symbol,
    resolution,
    segments.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    from,
    to,
    limit,
  )
  if (!bars.length) {
    const reasons = segments.map((result) => result.status === "rejected"
      ? dnseFailureCode(result.reason)
      : result.value.length ? "ok" : "empty")
    throw new Error(`${attempt.label}:${reasons.join(",")}`)
  }
  return { attempt, bars }
}

function publicKindsFor(symbol: IndexChartSymbol) {
  return symbol === "VNINDEX" ? ["index", "stock"] : ["derivative"]
}

function publicResolutionCandidates(resolution: Exclude<IndexChartResolution, "4H">) {
  if (resolution === "1H") return ["1H", "60"] as const
  if (resolution === "1D") return ["1D", "D"] as const
  return [resolution] as const
}

function trimHistory(bars: CandleBar[], from: number, to: number, maxPoints: number) {
  const filtered = bars.filter((bar) => bar.time >= from && bar.time <= to)
  const limit = Math.max(120, Math.min(maxPoints, 4_000))
  return filtered.slice(-limit)
}

function finalizeHistory(
  symbol: IndexChartSymbol,
  resolution: IndexChartResolution,
  sourceBars: CandleBar[],
  from: number,
  to: number,
  maxPoints: number,
) {
  const normalized = resolution === "4H"
    ? resampleCandleSeries(sourceBars, "4H", symbol)
    : sourceBars
  return trimHistory(normalized, from, to, maxPoints)
}

export async function fetchDnseIndexCandleHistory(
  symbol: IndexChartSymbol,
  now = new Date(),
  resolution: IndexChartResolution = "1",
  maxPoints?: number,
) {
  const config = HISTORY_CONFIG[resolution]
  const limit = maxPoints ?? config.maxPoints
  const to = Math.floor(now.getTime() / 1000)
  const from = to - config.lookbackDays * 24 * 60 * 60
  const failures = new Map<string, string>()
  const publicAttempts = PUBLIC_CHART_BASE_URLS.flatMap((baseUrl) =>
    publicKindsFor(symbol).flatMap((kind) =>
      publicResolutionCandidates(config.sourceResolution).map((sourceResolution) => ({
        baseUrl,
        kind,
        sourceResolution,
        label: `${new URL(baseUrl).hostname} ${kind} ${sourceResolution}`,
      })),
    ),
  )
  // DNSE 1-minute OHLC requests are bounded to seven-day windows in the
  // canonical minute-history reader. Keep each endpoint/resolution independent:
  // a valid response wins on its own and is never stitched with another source.
  const windows = resolution === "1"
    ? buildDnseRequestWindows(from, to, 7)
    : [{ from, to }]

  const trackFailure = <T,>(attempt: OhlcAttempt, promise: Promise<T>) => promise.catch((reason: unknown) => {
    const message = reason instanceof Error && reason.message.startsWith(`${attempt.label}:`)
      ? reason.message
      : `${attempt.label}:${dnseFailureCode(reason)}`
    failures.set(attempt.label, message)
    throw new Error(message)
  })

  const runPublic = (cancellationSignal: AbortSignal) => Promise.any(publicAttempts.map((attempt) => trackFailure(
    attempt,
    runOhlcAttempt(
      symbol,
      resolution,
      limit,
      from,
      to,
      windows,
      attempt,
      async (window) => normalizeDnseChartHistory(await publicChartGet(attempt.baseUrl, attempt.kind, {
        resolution: attempt.sourceResolution,
        symbol,
        from: window.from,
        to: window.to,
      }, cancellationSignal)),
    ),
  )))

  const signedResolutions = resolution === "1" ? ["1", "1m"] : [config.sourceResolution]
  const runSigned = (cancellationSignal: AbortSignal) => {
    const signedAttempts = signedResolutions.map((sourceResolution) =>
      openApiAttemptFor(symbol, sourceResolution, from, to),
    )
    return Promise.any(signedAttempts.map((attempt) => trackFailure(
      attempt,
      runOhlcAttempt(
        symbol,
        resolution,
        limit,
        from,
        to,
        windows,
        attempt,
        async (window) => normalizeDnseChartHistory(await signedGet({
          ...attempt.params,
          from: window.from,
          to: window.to,
        }, cancellationSignal)),
      ),
    )))
  }

  try {
    const { attempt, bars } = await raceHistoryTransports(runPublic, runSigned, SIGNED_HEDGE_DELAY_MS)
    return {
      symbol,
      resolution,
      bars,
      sessionDate: vietnamDateKey(bars[bars.length - 1].time),
      transport: attempt.label,
    }
  } catch {
    throw new Error(`DNSE OHLC unavailable for ${symbol} ${resolution} (${[...failures.values()].join("; ").slice(0, 1_400)})`)
  }
}
