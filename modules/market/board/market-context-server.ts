import "server-only"

import { normalizeDnseChartHistory } from "@/modules/market/providers/dnse/index-candles"
import type {
  MarketBoardContextBootstrap,
  MarketContextIndexSeries,
  MarketContextIndexSymbol,
  MarketImpactEntry,
  MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"

const PUBLIC_CHART_BASE_URLS = [
  "https://api.dnse.com.vn/chart-api/v2/ohlcs",
  "https://services.entrade.com.vn/chart-api/v2/ohlcs",
] as const
const INDEX_IMPACT_URL = "https://api.dnse.com.vn/market-api/basket-influence?type=VNINDEX"
const PUBLIC_TIMEOUT_MS = 4_000
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"
const INDEX_LOOKBACK_DAYS = 7
const MAX_SESSION_POINTS = 360

function vietnamDateKey(timestampSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampSeconds * 1000))
}

async function fetchPublicJson(url: URL | string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://banggia.dnse.com.vn",
      Referer: "https://banggia.dnse.com.vn/",
      "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

export async function fetchMarketContextIndexSeries(
  symbol: MarketContextIndexSymbol,
  now = new Date(),
): Promise<MarketContextIndexSeries> {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - INDEX_LOOKBACK_DAYS * 24 * 60 * 60
  const failures: string[] = []

  for (const baseUrl of PUBLIC_CHART_BASE_URLS) {
    try {
      const url = new URL(`${baseUrl}/index`)
      url.searchParams.set("symbol", symbol)
      url.searchParams.set("resolution", "1")
      url.searchParams.set("from", String(from))
      url.searchParams.set("to", String(to))
      const bars = normalizeDnseChartHistory(await fetchPublicJson(url))
      if (!bars.length) {
        failures.push(`${new URL(baseUrl).hostname}: empty`)
        continue
      }

      const latestSessionDate = vietnamDateKey(bars[bars.length - 1].time)
      const sessionBars = bars
        .filter((bar) => vietnamDateKey(bar.time) === latestSessionDate)
        .slice(-MAX_SESSION_POINTS)
      if (!sessionBars.length) {
        failures.push(`${new URL(baseUrl).hostname}: no latest-session bars`)
        continue
      }

      const last = sessionBars[sessionBars.length - 1]
      return {
        symbol,
        sessionDate: latestSessionDate,
        points: sessionBars.map((bar) => ({ time: bar.time, value: bar.close })),
        asOf: new Date(last.time * 1000).toISOString(),
        source: `DNSE public index chart · ${new URL(baseUrl).hostname}`,
      }
    } catch (error) {
      failures.push(`${new URL(baseUrl).hostname}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }

  throw new Error(`Index history unavailable for ${symbol} (${failures.join("; ")})`)
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return []
  const record = payload as Record<string, unknown>
  for (const key of ["data", "result", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  return []
}

function providerTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date((value > 10_000_000_000 ? value : value * 1000)).toISOString()
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const seconds = Number(record.seconds ?? record.Seconds)
  const nanos = Number(record.nanos ?? record.Nanos ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(nanos)) return null
  return new Date((seconds + nanos / 1_000_000_000) * 1000).toISOString()
}

function parseImpactEntry(row: unknown): MarketImpactEntry | null {
  if (!row || typeof row !== "object") return null
  const record = row as Record<string, unknown>
  const symbol = String(record.symbol ?? "").trim().toUpperCase()
  const contribution = Number(record.basketInfluence)
  if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !Number.isFinite(contribution)) return null
  return {
    symbol,
    contribution,
    asOf: providerTimestamp(record.time),
  }
}

export function parseVnindexImpactPayload(payload: unknown): MarketImpactSnapshot | null {
  const rows = rowsFromPayload(payload)
  const entries = rows.map(parseImpactEntry).filter((entry): entry is MarketImpactEntry => Boolean(entry))
  if (!entries.length) return null

  const positive = entries
    .filter((entry) => entry.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 8)
  const negative = entries
    .filter((entry) => entry.contribution < 0)
    .sort((left, right) => left.contribution - right.contribution)
    .slice(0, 8)
  const displayedPositiveTotal = positive.reduce((total, entry) => total + entry.contribution, 0)
  const displayedNegativeTotal = negative.reduce((total, entry) => total + entry.contribution, 0)
  const timestamps = entries
    .map((entry) => entry.asOf)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    source: "DNSE basket-influence · VNINDEX",
    scope: "VNINDEX",
    asOf: timestamps.at(-1) ?? null,
    providerRows: rows.length,
    finiteRows: entries.length,
    positive,
    negative,
    displayedPositiveTotal,
    displayedNegativeTotal,
    displayedNetTotal: displayedPositiveTotal + displayedNegativeTotal,
  }
}

export async function fetchVnindexImpactSnapshot(): Promise<MarketImpactSnapshot> {
  const parsed = parseVnindexImpactPayload(await fetchPublicJson(INDEX_IMPACT_URL))
  if (!parsed) throw new Error("VNINDEX basket-influence returned no finite contribution rows")
  return parsed
}

export async function loadMarketBoardContext(now = new Date()): Promise<MarketBoardContextBootstrap> {
  const settled = await Promise.allSettled([
    fetchMarketContextIndexSeries("VNINDEX", now),
    fetchMarketContextIndexSeries("VN30", now),
    fetchVnindexImpactSnapshot(),
  ])
  const indexes: MarketBoardContextBootstrap["indexes"] = {}
  const errors: string[] = []

  const vnindex = settled[0]
  if (vnindex.status === "fulfilled") indexes.VNINDEX = vnindex.value
  else errors.push(`VNINDEX: ${vnindex.reason instanceof Error ? vnindex.reason.message : String(vnindex.reason)}`)

  const vn30 = settled[1]
  if (vn30.status === "fulfilled") indexes.VN30 = vn30.value
  else errors.push(`VN30: ${vn30.reason instanceof Error ? vn30.reason.message : String(vn30.reason)}`)

  const impactResult = settled[2]
  const impact = impactResult.status === "fulfilled" ? impactResult.value : null
  if (impactResult.status === "rejected") {
    errors.push(`Index impact: ${impactResult.reason instanceof Error ? impactResult.reason.message : String(impactResult.reason)}`)
  }

  return {
    generatedAt: now.toISOString(),
    indexes,
    impact,
    errors,
  }
}
