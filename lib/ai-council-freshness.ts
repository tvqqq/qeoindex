import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export const AI_COUNCIL_EOD_FRESHNESS_VERSION = "eod-freshness-v1"
export const AI_COUNCIL_EXPECTED_STOCKS = 100

const VIETNAM_EOD_SYNC_HOUR_UTC = 7
const VIETNAM_EOD_SYNC_MINUTE_UTC = 50

interface MarketSnapshotRow {
  symbol: string
  session_date: string
  updated_at: string | null
}

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
    sessionDate: string | null
    freshCount: number
    staleOrMissingTickers: string[]
    latestUpdatedAt: string | null
  }
  wyckoff1d: {
    sessionDate: string | null
    freshCount: number
    staleOrMissingTickers: string[]
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

function eodCutoffUtc(sessionDate: string) {
  return new Date(`${sessionDate}T00:00:00.000Z`).getTime()
    + VIETNAM_EOD_SYNC_HOUR_UTC * 60 * 60 * 1000
    + VIETNAM_EOD_SYNC_MINUTE_UTC * 60 * 1000
}

function isFinalMarketSnapshot(row: MarketSnapshotRow, ratingDate: string) {
  if (row.session_date !== ratingDate || !row.updated_at) return false
  const updatedAt = new Date(row.updated_at).getTime()
  return Number.isFinite(updatedAt) && updatedAt >= eodCutoffUtc(ratingDate)
}

export async function assertAiCouncilEodFreshness(
  supabase: SupabaseClient,
  input: {
    ratingDate: string | null
    tickers: string[]
    benchmarkSessionDate: string | null
  },
): Promise<AiCouncilEodFreshnessReport> {
  const tickers = uniqueTickers(input.tickers)
  const issues: string[] = []

  if (!input.ratingDate) {
    const report: AiCouncilEodFreshnessReport = {
      version: AI_COUNCIL_EOD_FRESHNESS_VERSION,
      ok: false,
      ratingDate: null,
      expectedStocks: AI_COUNCIL_EXPECTED_STOCKS,
      requestedStocks: tickers.length,
      benchmarkSessionDate: input.benchmarkSessionDate,
      market: { sessionDate: null, freshCount: 0, staleOrMissingTickers: tickers, latestUpdatedAt: null },
      wyckoff1d: { sessionDate: null, freshCount: 0, staleOrMissingTickers: tickers, latestBarClosedAt: null },
      issues: ["ratingDate is missing"],
    }
    throw new AiCouncilUpstreamStaleError(report)
  }

  if (tickers.length !== AI_COUNCIL_EXPECTED_STOCKS) {
    issues.push(`Top100 universe incomplete: ${tickers.length}/${AI_COUNCIL_EXPECTED_STOCKS}`)
  }

  const [marketResult, wyckoffResult] = await Promise.all([
    supabase
      .from("stock_orderbook_snapshots")
      .select("symbol,session_date,updated_at")
      .eq("session_date", input.ratingDate)
      .in("symbol", tickers),
    supabase
      .from("wyckoff_latest_by_timeframe")
      .select("ticker,timeframe,bar_closed_at")
      .eq("timeframe", "1D")
      .in("ticker", tickers),
  ])

  if (marketResult.error) throw new Error(`Load EOD market freshness failed: ${marketResult.error.message}`)
  if (wyckoffResult.error) throw new Error(`Load Wyckoff freshness failed: ${wyckoffResult.error.message}`)

  const marketRows = (marketResult.data || []) as MarketSnapshotRow[]
  const marketByTicker = new Map(marketRows.map((row) => [row.symbol.toUpperCase(), row]))
  const marketFreshTickers = tickers.filter((ticker) => {
    const row = marketByTicker.get(ticker)
    return row ? isFinalMarketSnapshot(row, input.ratingDate!) : false
  })
  const marketMissing = tickers.filter((ticker) => !marketFreshTickers.includes(ticker))
  const latestMarketUpdatedAt = marketRows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null

  const wyckoffRows = (wyckoffResult.data || []) as WyckoffDailyRow[]
  const wyckoffByTicker = new Map(wyckoffRows.map((row) => [row.ticker.toUpperCase(), row]))
  const wyckoffFreshTickers = tickers.filter((ticker) => {
    const row = wyckoffByTicker.get(ticker)
    return isoDate(row?.bar_closed_at) === input.ratingDate
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
    expectedStocks: AI_COUNCIL_EXPECTED_STOCKS,
    requestedStocks: tickers.length,
    benchmarkSessionDate: input.benchmarkSessionDate,
    market: {
      sessionDate: input.ratingDate,
      freshCount: marketFreshTickers.length,
      staleOrMissingTickers: marketMissing,
      latestUpdatedAt: latestMarketUpdatedAt,
    },
    wyckoff1d: {
      sessionDate: input.ratingDate,
      freshCount: wyckoffFreshTickers.length,
      staleOrMissingTickers: wyckoffMissing,
      latestBarClosedAt: latestWyckoffBar,
    },
    issues,
  }

  if (!report.ok) throw new AiCouncilUpstreamStaleError(report)
  return report
}
