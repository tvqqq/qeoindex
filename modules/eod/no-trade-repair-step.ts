import type { OhlcvBar } from "../../modules/shared/technical/indicators.ts"

const FINAL_ORDERBOOK_CUTOFF_HOUR_UTC = 7
const FINAL_ORDERBOOK_CUTOFF_MINUTE_UTC = 45
const DAILY_BAR_HOUR_UTC = 2
const MAX_CANONICAL_UNIVERSE_SIZE = 200

export interface FinalOrderbookQuote {
  openPrice: number | string | null
  highPrice: number | string | null
  lowPrice: number | string | null
  matchPrice: number | string | null
  totalVolume: number | string | null
}

export interface FinalOrderbookSnapshot {
  symbol: string
  session_date: string
  reference_price: number | string | null
  latest_price: number | string | null
  total_volume: number | string | null
  updated_at: string | null
  latest_quote?: FinalOrderbookQuote | null
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function validSessionDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function cutoffMs(sessionDate: string) {
  return new Date(`${sessionDate}T00:00:00.000Z`).getTime()
    + FINAL_ORDERBOOK_CUTOFF_HOUR_UTC * 60 * 60 * 1000
    + FINAL_ORDERBOOK_CUTOFF_MINUTE_UTC * 60 * 1000
}

function nextSessionBoundary(sessionDate: string) {
  const next = new Date(`${sessionDate}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

function dailyBarTime(sessionDate: string) {
  return Math.floor(
    new Date(`${sessionDate}T${String(DAILY_BAR_HOUR_UTC).padStart(2, "0")}:00:00.000Z`).getTime() / 1000,
  )
}

export function buildVerifiedFinalDailyBar(
  tickerInput: string,
  sessionDate: string,
  snapshot: FinalOrderbookSnapshot,
): OhlcvBar | null {
  if (!validSessionDate(sessionDate)) return null
  const ticker = normalizeTicker(tickerInput)
  if (!ticker || normalizeTicker(snapshot.symbol || "") !== ticker) return null
  if (snapshot.session_date !== sessionDate || !snapshot.updated_at) return null

  const updatedAt = new Date(snapshot.updated_at).getTime()
  if (!Number.isFinite(updatedAt) || updatedAt < cutoffMs(sessionDate)) return null

  const latestPrice = finiteNumber(snapshot.latest_price)
  const volume = finiteNumber(snapshot.total_volume)
  if (latestPrice == null || latestPrice <= 0 || volume == null || volume < 0) return null

  if (volume === 0) {
    const referencePrice = finiteNumber(snapshot.reference_price)
    if (referencePrice == null || referencePrice <= 0) return null
    if (Math.abs(latestPrice - referencePrice) >= 1e-9) return null
    return {
      time: dailyBarTime(sessionDate),
      open: latestPrice,
      high: latestPrice,
      low: latestPrice,
      close: latestPrice,
      volume: 0,
    }
  }

  const quote = snapshot.latest_quote
  if (!quote) return null
  const open = finiteNumber(quote.openPrice)
  const high = finiteNumber(quote.highPrice)
  const low = finiteNumber(quote.lowPrice)
  const close = finiteNumber(quote.matchPrice)
  const quoteVolume = finiteNumber(quote.totalVolume)
  if (
    open == null || high == null || low == null || close == null || quoteVolume == null
    || open <= 0 || high <= 0 || low <= 0 || close <= 0 || quoteVolume <= 0
  ) return null
  if (Math.abs(quoteVolume - volume) >= 1e-9) return null
  if (Math.abs(close - latestPrice) >= 1e-9) return null
  if (high < low) return null

  return {
    time: dailyBarTime(sessionDate),
    open,
    high: Math.max(open, high, close),
    low: Math.min(open, low, close),
    close,
    volume: quoteVolume,
  }
}

export function buildVerifiedNoTradeDailyBar(
  tickerInput: string,
  sessionDate: string,
  snapshot: FinalOrderbookSnapshot,
) {
  return buildVerifiedFinalDailyBar(tickerInput, sessionDate, snapshot)
}

export async function runEodNoTradeDailyRepairStep(
  inputTickers: string[],
  sessionDate: string,
  enabled = true,
) {
  "use step"

  if (!enabled) {
    return {
      skipped: true as const,
      sessionDate,
      expectedCount: inputTickers.length,
      existingCount: 0,
      repairedCount: 0,
      finalCount: 0,
      repairedTickers: [] as string[],
    }
  }
  if (!validSessionDate(sessionDate)) throw new Error(`Invalid EOD final Daily repair session date: ${sessionDate}`)

  const tickers = [...new Set(inputTickers.map(normalizeTicker).filter(Boolean))]
  if (!tickers.length || tickers.length > MAX_CANONICAL_UNIVERSE_SIZE) {
    throw new Error(
      `EOD final Daily repair requires 1-${MAX_CANONICAL_UNIVERSE_SIZE} unique tickers; received ${tickers.length}`,
    )
  }

  const { getSupabaseServerClient } = await import("../../modules/shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  const start = `${sessionDate}T00:00:00.000Z`
  const end = nextSessionBoundary(sessionDate)
  const existing = await supabase
    .from("market_ohlcv_history")
    .select("ticker")
    .eq("timeframe", "1D")
    .in("ticker", tickers)
    .gte("bar_time", start)
    .lt("bar_time", end)
  if (existing.error) throw new Error(`Load exact EOD Daily bars failed: ${existing.error.message}`)

  const existingTickers = new Set(
    (existing.data || [])
      .map((row) => normalizeTicker(String(row.ticker || "")))
      .filter(Boolean),
  )
  const missingTickers = tickers.filter((ticker) => !existingTickers.has(ticker))
  const repairedTickers: string[] = []

  if (missingTickers.length) {
    const snapshots = await supabase
      .from("stock_orderbook_snapshots")
      .select("symbol,session_date,reference_price,latest_price,total_volume,updated_at,latest_quote")
      .eq("session_date", sessionDate)
      .in("symbol", missingTickers)
    if (snapshots.error) throw new Error(`Load final orderbook evidence failed: ${snapshots.error.message}`)

    const snapshotByTicker = new Map(
      ((snapshots.data || []) as FinalOrderbookSnapshot[]).map((row) => [normalizeTicker(row.symbol), row]),
    )
    const fetchedAt = new Date().toISOString()
    const rows = missingTickers.flatMap((ticker) => {
      const snapshot = snapshotByTicker.get(ticker)
      const bar = snapshot ? buildVerifiedFinalDailyBar(ticker, sessionDate, snapshot) : null
      if (!bar) return []
      repairedTickers.push(ticker)
      return [{
        ticker,
        timeframe: "1D",
        bar_time: new Date(bar.time * 1000).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        provider: "Fallback",
        provider_detail: "Verified final market-close repair from stock_orderbook_snapshots",
        source_url: "internal://stock_orderbook_snapshots",
        fetched_at: fetchedAt,
      }]
    })

    if (rows.length) {
      const upsert = await supabase
        .from("market_ohlcv_history")
        .upsert(rows, { onConflict: "ticker,timeframe,bar_time" })
      if (upsert.error) throw new Error(`Persist verified final Daily repair failed: ${upsert.error.message}`)
    }
  }

  const finalRows = await supabase
    .from("market_ohlcv_history")
    .select("ticker")
    .eq("timeframe", "1D")
    .in("ticker", tickers)
    .gte("bar_time", start)
    .lt("bar_time", end)
  if (finalRows.error) throw new Error(`Verify exact EOD Daily bars failed: ${finalRows.error.message}`)

  const finalTickers = new Set(
    (finalRows.data || [])
      .map((row) => normalizeTicker(String(row.ticker || "")))
      .filter(Boolean),
  )
  const stillMissing = tickers.filter((ticker) => !finalTickers.has(ticker))
  if (stillMissing.length) {
    throw new Error(
      `Exact EOD Daily bars incomplete after verified final repair: ${finalTickers.size}/${tickers.length}`
      + `; missing ${stillMissing.join(", ")}`,
    )
  }

  return {
    skipped: false as const,
    sessionDate,
    expectedCount: tickers.length,
    existingCount: existingTickers.size,
    repairedCount: repairedTickers.length,
    finalCount: finalTickers.size,
    repairedTickers,
  }
}
