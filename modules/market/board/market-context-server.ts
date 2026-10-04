import "server-only"

import { normalizeDnseChartHistory } from "@/modules/market/providers/dnse/index-candles"
import {
  parseVnindexImpactPayload,
  type MarketBoardContextBootstrap,
  type MarketContextIndexSeries,
  type MarketContextIndexSymbol,
  type MarketImpactSnapshot,
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

export async function fetchVnindexImpactSnapshot(): Promise<MarketImpactSnapshot> {
  const parsed = parseVnindexImpactPayload(await fetchPublicJson(INDEX_IMPACT_URL))
  if (!parsed) throw new Error("VNINDEX basket-influence returned no finite contribution rows")
  return parsed
}

export async function loadMarketBoardContext(now = new Date()): Promise<MarketBoardContextBootstrap> {
  const settled = await Promise.allSettled([
    fetchMarketContextIndexSeries("VNINDEX", now),
    fetchMarketContextIndexSeries("VN30", now),
    fetchMarketContextIndexSeries("HNXINDEX", now),
    fetchMarketContextIndexSeries("UPCOMINDEX", now),
    fetchVnindexImpactSnapshot(),
  ])
  const indexes: MarketBoardContextBootstrap["indexes"] = {}
  const errors: string[] = []
  const indexSymbols = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"] as const

  indexSymbols.forEach((symbol, index) => {
    const outcome = settled[index]
    if (outcome.status === "fulfilled") indexes[symbol] = outcome.value
    else errors.push(`${symbol}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`)
  })

  const impactResult = settled[4]
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
