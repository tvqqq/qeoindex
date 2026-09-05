import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "@/modules/market/calendar"
import { fetchDailyMarketHistoryWindow } from "@/modules/market/history/index"

const MAX_REPAIR_TICKERS = 10
const DAY_MS = 86_400_000

type IntegrityReportRow = {
  ticker?: unknown
  missing_expected_sessions?: unknown
  missing_session_dates?: unknown
  unclassified_zero_volume_rows?: unknown
  status?: unknown
}

type StoredZeroVolumeRow = {
  ticker?: unknown
  bar_time?: unknown
  provider?: unknown
  source_url?: unknown
  provider_detail?: unknown
}

export interface DailyIntegrityRepairTickerResult {
  ticker: string
  suspectSessions: number
  repairedSessions: number
  unresolvedSessions: string[]
  provider: string | null
  statusBefore: string | null
  statusAfter: string | null
}

export interface DailyIntegrityRepairResult {
  requestedTickers: number
  repairedSessions: number
  unresolvedSessions: number
  tickers: DailyIntegrityRepairTickerResult[]
}

function normalizeTickers(input: string[]) {
  const result = [...new Set(input.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))]
  if (!result.length || result.length > MAX_REPAIR_TICKERS) {
    throw new Error(`Daily integrity repair requires 1-${MAX_REPAIR_TICKERS} unique tickers`)
  }
  for (const ticker of result) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`)
  }
  return result
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)) : []
}

function lookbackDays(oldestDate: string, now: Date) {
  const oldest = new Date(`${oldestDate}T00:00:00+07:00`).getTime()
  return Math.max(14, Math.ceil((now.getTime() - oldest) / DAY_MS) + 10)
}

function isVerifiedNoTradeRow(row: StoredZeroVolumeRow) {
  const provider = String(row.provider || "")
  if (provider === "VCI" || provider === "DNSE") return true
  return provider === "Fallback"
    && String(row.source_url || "") === "internal://stock_orderbook_snapshots"
    && String(row.provider_detail || "").startsWith("Verified final market-close repair")
}

async function loadIntegrityReport(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("qeo_market_daily_integrity_report")
  if (error) throw new Error(`Load Daily integrity report failed: ${error.message}`)
  return (data || []) as IntegrityReportRow[]
}

async function loadUnclassifiedZeroDates(supabase: SupabaseClient, tickers: string[]) {
  const dates = new Map<string, string[]>()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from("market_ohlcv_history")
      .select("ticker,bar_time,provider,source_url,provider_detail")
      .eq("timeframe", "1D")
      .eq("volume", 0)
      .in("ticker", tickers)
      .order("ticker", { ascending: true })
      .order("bar_time", { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Load zero-volume Daily rows failed: ${error.message}`)
    const page = (data || []) as StoredZeroVolumeRow[]
    for (const row of page) {
      if (isVerifiedNoTradeRow(row)) continue
      const ticker = String(row.ticker || "").trim().toUpperCase()
      const timestamp = row.bar_time ? new Date(String(row.bar_time)).getTime() : NaN
      if (!ticker || !Number.isFinite(timestamp)) continue
      const dateKey = vietnamDateKey(timestamp)
      if (!isVietnamSecuritiesTradingDateKey(dateKey)) continue
      const current = dates.get(ticker) ?? []
      current.push(dateKey)
      dates.set(ticker, current)
    }
    if (page.length < pageSize) break
    offset += pageSize
  }
  return dates
}

async function repairTicker(
  supabase: SupabaseClient,
  ticker: string,
  report: IntegrityReportRow | undefined,
  zeroDates: string[],
  now: Date,
): Promise<DailyIntegrityRepairTickerResult> {
  const missingDates = stringArray(report?.missing_session_dates)
  const suspectDates = [...new Set([...missingDates, ...zeroDates])]
    .filter(isVietnamSecuritiesTradingDateKey)
    .sort()

  if (!suspectDates.length) {
    return {
      ticker,
      suspectSessions: 0,
      repairedSessions: 0,
      unresolvedSessions: [],
      provider: null,
      statusBefore: report?.status ? String(report.status) : null,
      statusAfter: report?.status ? String(report.status) : null,
    }
  }

  const history = await fetchDailyMarketHistoryWindow(ticker, lookbackDays(suspectDates[0], now), now)
  const byDate = new Map(history.bars.map((bar) => [vietnamDateKey(bar.time * 1000), bar]))
  const fetchedAt = history.fetchedAt || now.toISOString()
  const rows = suspectDates.flatMap((sessionDate) => {
    const bar = byDate.get(sessionDate)
    if (!bar) return []
    if (bar.volume === 0 && history.provider !== "VCI" && history.provider !== "DNSE") return []
    return [{
      ticker,
      timeframe: "1D",
      bar_time: new Date(bar.time * 1000).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      provider: history.provider,
      provider_detail: `QEO-106 targeted Daily integrity repair · ${history.detail}`,
      source_url: history.sourceUrl,
      fetched_at: fetchedAt,
    }]
  })

  if (rows.length) {
    const { error } = await supabase
      .from("market_ohlcv_history")
      .upsert(rows, { onConflict: "ticker,timeframe,bar_time" })
    if (error) throw new Error(`Persist Daily integrity repair for ${ticker} failed: ${error.message}`)
  }

  const repairedDates = new Set(rows.map((row) => vietnamDateKey(row.bar_time)))
  const unresolvedSessions = suspectDates.filter((dateKey) => !repairedDates.has(dateKey))
  return {
    ticker,
    suspectSessions: suspectDates.length,
    repairedSessions: repairedDates.size,
    unresolvedSessions,
    provider: history.provider,
    statusBefore: report?.status ? String(report.status) : null,
    statusAfter: null,
  }
}

export async function repairDailyIntegrityGaps(
  supabase: SupabaseClient,
  inputTickers: string[],
  now = new Date(),
): Promise<DailyIntegrityRepairResult> {
  const tickers = normalizeTickers(inputTickers)
  const [beforeRows, zeroDatesByTicker] = await Promise.all([
    loadIntegrityReport(supabase),
    loadUnclassifiedZeroDates(supabase, tickers),
  ])
  const beforeByTicker = new Map(beforeRows.map((row) => [String(row.ticker || "").toUpperCase(), row]))

  const tickerResults: DailyIntegrityRepairTickerResult[] = []
  for (const ticker of tickers) {
    tickerResults.push(await repairTicker(
      supabase,
      ticker,
      beforeByTicker.get(ticker),
      zeroDatesByTicker.get(ticker) ?? [],
      now,
    ))
  }

  const afterRows = await loadIntegrityReport(supabase)
  const afterByTicker = new Map(afterRows.map((row) => [String(row.ticker || "").toUpperCase(), row]))
  for (const result of tickerResults) {
    const after = afterByTicker.get(result.ticker)
    result.statusAfter = after?.status ? String(after.status) : null
  }

  return {
    requestedTickers: tickers.length,
    repairedSessions: tickerResults.reduce((sum, item) => sum + item.repairedSessions, 0),
    unresolvedSessions: tickerResults.reduce((sum, item) => sum + item.unresolvedSessions.length, 0),
    tickers: tickerResults,
  }
}
