import type { SupabaseClient } from "@supabase/supabase-js"

import type { CouncilRatingEvidence } from "@/lib/ai-council-model"

export const AI_COUNCIL_EOD_MARKET_VERSION = "eod-market-overlay-v1"

const EOD_FINAL_HOUR_UTC = 7
const EOD_FINAL_MINUTE_UTC = 50
const PERSISTENT_LOOKBACK_DAYS = 60
const PERSISTENT_BATCH_SIZE = 10

export interface AiCouncilEodMarketSnapshot {
  symbol: string
  session_date: string
  reference_price: number | string | null
  latest_price: number | string | null
  total_volume: number | string | null
  updated_at: string | null
}

interface PersistentDailyRow {
  ticker: string
  bar_time: string
  close: number | string | null
  volume: number | string | null
  fetched_at: string | null
}

export interface PersistentCouncilEodLoadResult {
  snapshots: AiCouncilEodMarketSnapshot[]
  missingTickers: string[]
  latestUpdatedAt: string | null
}

export interface AiCouncilEodMarketOverlayResult {
  applied: boolean
  version: typeof AI_COUNCIL_EOD_MARKET_VERSION
  rating: CouncilRatingEvidence
  source: {
    sessionDate: string | null
    updatedAt: string | null
    price: number | null
    referencePrice: number | null
    volume: number | null
  }
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function uniqueTickers(input: string[]) {
  return [...new Set(input.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
}

function isoDate(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : ""
}

function sessionWindow(sessionDate: string) {
  const end = new Date(`${sessionDate}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(`${sessionDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - PERSISTENT_LOOKBACK_DAYS)
  return { start: start.toISOString(), end: end.toISOString() }
}

function eodCutoffUtc(sessionDate: string) {
  return new Date(`${sessionDate}T00:00:00.000Z`).getTime()
    + EOD_FINAL_HOUR_UTC * 60 * 60 * 1000
    + EOD_FINAL_MINUTE_UTC * 60 * 1000
}

export function isFinalCouncilEodSnapshot(snapshot: AiCouncilEodMarketSnapshot, expectedSessionDate: string) {
  if (snapshot.session_date !== expectedSessionDate || !snapshot.updated_at) return false
  const updatedAt = new Date(snapshot.updated_at).getTime()
  return Number.isFinite(updatedAt) && updatedAt >= eodCutoffUtc(expectedSessionDate)
}

export async function loadPersistentCouncilEodSnapshots(
  supabase: SupabaseClient,
  inputTickers: string[],
  sessionDate: string,
): Promise<PersistentCouncilEodLoadResult> {
  const tickers = uniqueTickers(inputTickers)
  const { start, end } = sessionWindow(sessionDate)
  const rows: PersistentDailyRow[] = []

  for (let offset = 0; offset < tickers.length; offset += PERSISTENT_BATCH_SIZE) {
    const batch = tickers.slice(offset, offset + PERSISTENT_BATCH_SIZE)
    const { data, error } = await supabase
      .from("market_ohlcv_history")
      .select("ticker,bar_time,close,volume,fetched_at")
      .eq("timeframe", "1D")
      .in("ticker", batch)
      .gte("bar_time", start)
      .lt("bar_time", end)
      .order("bar_time", { ascending: true })

    if (error) throw new Error(`Load persistent Council EOD market_ohlcv_history failed: ${error.message}`)
    rows.push(...((data || []) as PersistentDailyRow[]))
  }

  const rowsByTicker = new Map<string, PersistentDailyRow[]>()
  for (const row of rows) {
    const ticker = String(row.ticker || "").trim().toUpperCase()
    if (!ticker) continue
    rowsByTicker.set(ticker, [...(rowsByTicker.get(ticker) || []), row])
  }

  const snapshots: AiCouncilEodMarketSnapshot[] = []
  for (const ticker of tickers) {
    const tickerRows = (rowsByTicker.get(ticker) || [])
      .filter((row) => Boolean(isoDate(row.bar_time)))
      .sort((left, right) => new Date(left.bar_time).getTime() - new Date(right.bar_time).getTime())
    const current = tickerRows.filter((row) => isoDate(row.bar_time) === sessionDate).at(-1)
    const previous = tickerRows.filter((row) => isoDate(row.bar_time) < sessionDate).at(-1)
    const latestPrice = finiteNumber(current?.close)
    const referencePrice = finiteNumber(previous?.close)
    const volume = finiteNumber(current?.volume)

    if (!current || !previous || latestPrice == null || latestPrice <= 0 || referencePrice == null || referencePrice <= 0 || volume == null || volume < 0) {
      continue
    }

    const snapshot: AiCouncilEodMarketSnapshot = {
      symbol: ticker,
      session_date: sessionDate,
      reference_price: referencePrice,
      latest_price: latestPrice,
      total_volume: volume,
      updated_at: current.fetched_at,
    }
    if (isFinalCouncilEodSnapshot(snapshot, sessionDate)) snapshots.push(snapshot)
  }

  const snapshotTickers = new Set(snapshots.map((row) => row.symbol))
  const missingTickers = tickers.filter((ticker) => !snapshotTickers.has(ticker))
  const latestUpdatedAt = snapshots
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null

  return { snapshots, missingTickers, latestUpdatedAt }
}

export function overlayCouncilRatingWithEodSnapshot(
  rating: CouncilRatingEvidence,
  snapshot: AiCouncilEodMarketSnapshot | null | undefined,
  expectedSessionDate: string,
): AiCouncilEodMarketOverlayResult {
  const price = finiteNumber(snapshot?.latest_price)
  const referencePrice = finiteNumber(snapshot?.reference_price)
  const volume = finiteNumber(snapshot?.total_volume)
  const tickerMatches = snapshot?.symbol?.trim().toUpperCase() === rating.ticker.trim().toUpperCase()
  const final = Boolean(snapshot && tickerMatches && isFinalCouncilEodSnapshot(snapshot, expectedSessionDate))
  const usable = final && price != null && price > 0 && referencePrice != null && referencePrice > 0 && volume != null && volume >= 0

  if (!usable) {
    return {
      applied: false,
      version: AI_COUNCIL_EOD_MARKET_VERSION,
      rating,
      source: {
        sessionDate: snapshot?.session_date || null,
        updatedAt: snapshot?.updated_at || null,
        price,
        referencePrice,
        volume,
      },
    }
  }

  return {
    applied: true,
    version: AI_COUNCIL_EOD_MARKET_VERSION,
    rating: {
      ...rating,
      price,
      changePct: ((price - referencePrice) / referencePrice) * 100,
      liquidity: {
        ...rating.liquidity,
        volume1d: volume,
      },
    },
    source: {
      sessionDate: snapshot!.session_date,
      updatedAt: snapshot!.updated_at,
      price,
      referencePrice,
      volume,
    },
  }
}
