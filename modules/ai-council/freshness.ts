import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  isFinalCouncilEodSnapshot,
  loadPersistentCouncilEodSnapshots,
  type AiCouncilEodMarketSnapshot,
} from "@/modules/ai-council/eod-market"

export const AI_COUNCIL_EOD_FRESHNESS_VERSION = "eod-freshness-v2"

export type AiCouncilEodMarketSource = "live_snapshot" | "persistent_ohlcv"

interface WyckoffDailyRow {
  ticker: string
  timeframe: string
  bar_closed_at: string | null
}

export interface AiCouncilEodFreshnessReport {
  version: typeof AI_COUNCIL_EOD_FRESHNESS_VERSION
  ok: boolean
  ratingDate: string | null
  expectedStocks: number
  requestedStocks: number
  benchmarkSessionDate: string | null
  market: {
    source: AiCouncilEodMarketSource
    sessionDate: string | null
    freshCount: number
    staleOrMissingTickers: string[]
    latestUpdatedAt: string | null
  }
  wyckoff1d: {
    sessionDate: string | null
    freshCount: number
    staleOrMissingTickers: string[]
    carryForwardTickers: string[]
    latestBarClosedAt: string | null
  }
  issues: string[]
}

export class AiCouncilUpstreamStaleError extends Error {
  readonly code = "UPSTREAM_STALE"
  readonly report: AiCouncilEodFreshnessReport

  constructor(report: AiCouncilEodFreshnessReport) {
    super(`UPSTREAM_STALE: ${report.issues.join("; ")}`)
    this.name = "AiCouncilUpstreamStaleError"
    this.report = report
  }
}

function uniqueTickers(tickers: string[]) {
  return [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort()
}

function isoDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isPersistentNoTradeCarryForward(
  market: AiCouncilEodMarketSnapshot,
  wyckoffBarClosedAt: string | null,
  ratingDate: string,
) {
  const wyckoffDate = isoDate(wyckoffBarClosedAt)
  if (!wyckoffDate || wyckoffDate >= ratingDate) return false
  if (Number(market.total_volume) !== 0) return false
  const latestPrice = finiteNumber(market.latest_price)
  const referencePrice = finiteNumber(market.reference_price)
  if (latestPrice == null || referencePrice == null) return false
  return Math.abs(latestPrice - referencePrice) < 1e-9
}

export async function assertAiCouncilEodFreshness(
  supabase: SupabaseClient,
  input: {
    ratingDate: string | null
    tickers: string[]
    benchmarkSessionDate: string | null
    marketSource?: AiCouncilEodMarketSource
  },
): Promise<AiCouncilEodFreshnessReport> {
  const tickers = uniqueTickers(input.tickers)
  const { getCanonicalUniverse } = await import("@/modules/market/universe/index")
  const canonical = await getCanonicalUniverse()
  const canonicalTickers = canonical.stocks.map((stock) => stock.ticker)
  const canonicalSet = new Set(canonicalTickers)
  const requestedSet = new Set(tickers)
  const expectedStocks = canonical.selectedCount
  const missingCanonical = canonicalTickers.filter((ticker) => !requestedSet.has(ticker))
  const unexpectedTickers = tickers.filter((ticker) => !canonicalSet.has(ticker))
  const issues: string[] = []
  const marketSource = input.marketSource ?? "live_snapshot"

  if (
    tickers.length !== expectedStocks
    || missingCanonical.length > 0
    || unexpectedTickers.length > 0
  ) {
    issues.push(
      `Canonical universe mismatch: requested ${tickers.length}/${expectedStocks}`
      + `${missingCanonical.length ? `; missing=${missingCanonical.slice(0, 20).join(",")}` : ""}`
      + `${unexpectedTickers.length ? `; unexpected=${unexpectedTickers.slice(0, 20).join(",")}` : ""}`,
    )
  }

  if (!input.ratingDate) {
    const report: AiCouncilEodFreshnessReport = {
      version: AI_COUNCIL_EOD_FRESHNESS_VERSION,
      ok: false,
      ratingDate: null,
      expectedStocks,
      requestedStocks: tickers.length,
      benchmarkSessionDate: input.benchmarkSessionDate,
      market: { source: marketSource, sessionDate: null, freshCount: 0, staleOrMissingTickers: tickers, latestUpdatedAt: null },
      wyckoff1d: { sessionDate: null, freshCount: 0, staleOrMissingTickers: tickers, carryForwardTickers: [], latestBarClosedAt: null },
      issues: [...issues, "ratingDate is missing"],
    }
    throw new AiCouncilUpstreamStaleError(report)
  }

  let marketRows: AiCouncilEodMarketSnapshot[] = []
  let latestMarketUpdatedAt: string | null = null

  if (marketSource === "persistent_ohlcv") {
    const persistent = await loadPersistentCouncilEodSnapshots(supabase, tickers, input.ratingDate)
    marketRows = persistent.snapshots
    latestMarketUpdatedAt = persistent.latestUpdatedAt
  } else {
    const marketResult = await supabase
      .from("stock_orderbook_snapshots")
      .select("symbol,session_date,reference_price,latest_price,total_volume,updated_at")
      .eq("session_date", input.ratingDate)
      .in("symbol", tickers)
    if (marketResult.error) throw new Error(`Load EOD market freshness failed: ${marketResult.error.message}`)
    marketRows = (marketResult.data || []) as AiCouncilEodMarketSnapshot[]
    latestMarketUpdatedAt = marketRows
      .map((row) => row.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null
  }

  const wyckoffResult = await supabase
    .from("wyckoff_latest_by_timeframe")
    .select("ticker,timeframe,bar_closed_at")
    .eq("timeframe", "1D")
    .in("ticker", tickers)
  if (wyckoffResult.error) throw new Error(`Load Wyckoff freshness failed: ${wyckoffResult.error.message}`)

  const marketByTicker = new Map(marketRows.map((row) => [row.symbol.toUpperCase(), row]))
  const marketFreshTickers = tickers.filter((ticker) => {
    const row = marketByTicker.get(ticker)
    return row ? isFinalCouncilEodSnapshot(row, input.ratingDate!) : false
  })
  const marketMissing = tickers.filter((ticker) => !marketFreshTickers.includes(ticker))

  const wyckoffRows = (wyckoffResult.data || []) as WyckoffDailyRow[]
  const wyckoffByTicker = new Map(wyckoffRows.map((row) => [row.ticker.toUpperCase(), row]))
  const carryForwardTickers: string[] = []
  const wyckoffFreshTickers = tickers.filter((ticker) => {
    const row = wyckoffByTicker.get(ticker)
    const wyckoffBarClosedAt = row?.bar_closed_at || null
    if (isoDate(wyckoffBarClosedAt) === input.ratingDate) return true
    const marketRow = marketByTicker.get(ticker)
    const canCarryForward = marketSource === "persistent_ohlcv"
      && Boolean(marketRow)
      && isPersistentNoTradeCarryForward(marketRow!, wyckoffBarClosedAt, input.ratingDate!)
    if (canCarryForward) carryForwardTickers.push(ticker)
    return canCarryForward
  })
  const wyckoffMissing = tickers.filter((ticker) => !wyckoffFreshTickers.includes(ticker))
  const latestWyckoffBar = wyckoffRows
    .map((row) => row.bar_closed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null

  if (marketFreshTickers.length !== tickers.length) {
    issues.push(`EOD market snapshots stale/missing: ${marketFreshTickers.length}/${tickers.length}`)
  }
  if (wyckoffFreshTickers.length !== tickers.length) {
    issues.push(`Wyckoff 1D stale/missing: ${wyckoffFreshTickers.length}/${tickers.length}`)
  }
  if (input.benchmarkSessionDate !== input.ratingDate) {
    issues.push(`VNINDEX benchmark stale: ${input.benchmarkSessionDate || "missing"} != ${input.ratingDate}`)
  }

  const report: AiCouncilEodFreshnessReport = {
    version: AI_COUNCIL_EOD_FRESHNESS_VERSION,
    ok: issues.length === 0,
    ratingDate: input.ratingDate,
    expectedStocks,
    requestedStocks: tickers.length,
    benchmarkSessionDate: input.benchmarkSessionDate,
    market: {
      source: marketSource,
      sessionDate: input.ratingDate,
      freshCount: marketFreshTickers.length,
      staleOrMissingTickers: marketMissing,
      latestUpdatedAt: latestMarketUpdatedAt,
    },
    wyckoff1d: {
      sessionDate: input.ratingDate,
      freshCount: wyckoffFreshTickers.length,
      staleOrMissingTickers: wyckoffMissing,
      carryForwardTickers,
      latestBarClosedAt: latestWyckoffBar,
    },
    issues,
  }

  if (!report.ok) throw new AiCouncilUpstreamStaleError(report)
  return report
}
