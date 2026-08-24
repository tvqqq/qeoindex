import type { SupabaseClient } from "@supabase/supabase-js"

export const WYCKOFF_EOD_EXPECTED_STOCKS = 100
export const WYCKOFF_EOD_BATCH_SIZE = 10
export const WYCKOFF_EOD_REFRESH_VERSION = "wyckoff-eod-refresh-v1"

type DailyRow = {
  ticker: string
  timeframe: string
  bar_closed_at: string | null
}

export interface WyckoffEodDailyValidation {
  ok: boolean
  expectedSessionDate: string
  expectedCount: number
  freshCount: number
  staleOrMissingTickers: string[]
  latestBarClosedAt: string | null
}

export interface WyckoffEodRefreshResult {
  ok: boolean
  version: typeof WYCKOFF_EOD_REFRESH_VERSION
  expectedSessionDate: string
  requestedStocks: number
  batchCount: number
  completedStocks: number
  batchErrors: Array<{ offset: number; errors: Array<{ ticker: string; error: string }> }>
  validation: WyckoffEodDailyValidation
}

export class WyckoffEodIncompleteError extends Error {
  readonly code = "WYCKOFF_EOD_INCOMPLETE"
  readonly result: WyckoffEodRefreshResult

  constructor(result: WyckoffEodRefreshResult) {
    super(`WYCKOFF_EOD_INCOMPLETE: ${result.validation.freshCount}/${result.validation.expectedCount} same-session 1D snapshots`)
    this.name = "WyckoffEodIncompleteError"
    this.result = result
  }
}

function normalizedTicker(value: string) {
  return value.trim().toUpperCase()
}

function dateOnly(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

export function buildWyckoffEodBatchOffsets(
  total = WYCKOFF_EOD_EXPECTED_STOCKS,
  batchSize = WYCKOFF_EOD_BATCH_SIZE,
) {
  if (!Number.isInteger(total) || total < 1) throw new Error("total must be a positive integer")
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer")
  return Array.from({ length: Math.ceil(total / batchSize) }, (_, index) => index * batchSize)
}

export function validateWyckoffEodDailyRows(input: {
  expectedSessionDate: string
  expectedTickers: string[]
  rows: DailyRow[]
}): WyckoffEodDailyValidation {
  const expectedTickers = [...new Set(input.expectedTickers.map(normalizedTicker).filter(Boolean))].sort()
  const latestByTicker = new Map<string, DailyRow>()

  for (const row of input.rows) {
    if (row.timeframe !== "1D") continue
    const ticker = normalizedTicker(row.ticker)
    if (!expectedTickers.includes(ticker)) continue
    const current = latestByTicker.get(ticker)
    if (!current || (row.bar_closed_at || "") > (current.bar_closed_at || "")) {
      latestByTicker.set(ticker, row)
    }
  }

  const staleOrMissingTickers = expectedTickers.filter((ticker) => {
    return dateOnly(latestByTicker.get(ticker)?.bar_closed_at || null) !== input.expectedSessionDate
  })
  const latestBarClosedAt = [...latestByTicker.values()]
    .map((row) => row.bar_closed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null

  return {
    ok: staleOrMissingTickers.length === 0 && expectedTickers.length > 0,
    expectedSessionDate: input.expectedSessionDate,
    expectedCount: expectedTickers.length,
    freshCount: expectedTickers.length - staleOrMissingTickers.length,
    staleOrMissingTickers,
    latestBarClosedAt,
  }
}

async function loadExpectedTickers(supabase: SupabaseClient, expectedSessionDate: string) {
  const result = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .eq("is_published", true)
    .eq("as_of_date", expectedSessionDate)
    .order("top100_rank", { ascending: true, nullsFirst: false })
    .order("ticker", { ascending: true })

  if (result.error) throw new Error(`Load EOD Top100 universe failed: ${result.error.message}`)
  const tickers = [...new Set((result.data || []).map((row) => normalizedTicker(String(row.ticker || ""))).filter(Boolean))]
  if (tickers.length !== WYCKOFF_EOD_EXPECTED_STOCKS) {
    throw new Error(`WYCKOFF_EOD_UNIVERSE_INCOMPLETE: ${tickers.length}/${WYCKOFF_EOD_EXPECTED_STOCKS}`)
  }
  return tickers
}

export async function runWyckoffEodRefresh(
  supabase: SupabaseClient,
  input: { expectedSessionDate: string; tickers?: string[] },
): Promise<WyckoffEodRefreshResult> {
  const expectedTickers = input.tickers?.length
    ? [...new Set(input.tickers.map(normalizedTicker).filter(Boolean))]
    : await loadExpectedTickers(supabase, input.expectedSessionDate)

  if (expectedTickers.length !== WYCKOFF_EOD_EXPECTED_STOCKS) {
    throw new Error(`WYCKOFF_EOD_UNIVERSE_INCOMPLETE: ${expectedTickers.length}/${WYCKOFF_EOD_EXPECTED_STOCKS}`)
  }

  const { runUnifiedWyckoff } = await import("@/lib/wyckoff-unified-runner")
  const offsets = buildWyckoffEodBatchOffsets(expectedTickers.length, WYCKOFF_EOD_BATCH_SIZE)
  let completedStocks = 0
  const batchErrors: WyckoffEodRefreshResult["batchErrors"] = []

  for (const offset of offsets) {
    const batch = await runUnifiedWyckoff({ limit: WYCKOFF_EOD_BATCH_SIZE, offset })
    completedStocks += batch.completed.length
    if (batch.errors.length) batchErrors.push({ offset, errors: batch.errors })
  }

  const snapshotResult = await supabase
    .from("wyckoff_latest_by_timeframe")
    .select("ticker,timeframe,bar_closed_at")
    .eq("timeframe", "1D")
    .in("ticker", expectedTickers)

  if (snapshotResult.error) throw new Error(`Validate EOD Wyckoff snapshots failed: ${snapshotResult.error.message}`)

  const validation = validateWyckoffEodDailyRows({
    expectedSessionDate: input.expectedSessionDate,
    expectedTickers,
    rows: (snapshotResult.data || []) as DailyRow[],
  })
  const result: WyckoffEodRefreshResult = {
    ok: validation.ok && batchErrors.length === 0,
    version: WYCKOFF_EOD_REFRESH_VERSION,
    expectedSessionDate: input.expectedSessionDate,
    requestedStocks: expectedTickers.length,
    batchCount: offsets.length,
    completedStocks,
    batchErrors,
    validation,
  }

  if (!result.ok) throw new WyckoffEodIncompleteError(result)
  return result
}
