export interface GroupedDailyOhlcvRow {
  ticker: string
  timeframe: "1D"
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
}

interface GroupedRecentOhlcvPayload {
  ticker: string
  rows: unknown
}

const COMPACT_DAILY_ROW_WIDTH = 10

function normalizeTicker(value: unknown) {
  return String(value || "").trim().toUpperCase()
}

function decodeCompactDailyRow(ticker: string, value: unknown): GroupedDailyOhlcvRow {
  if (!Array.isArray(value) || value.length !== COMPACT_DAILY_ROW_WIDTH) {
    throw new Error(`OHLCV_GROUPED_ROW_INVALID: ${ticker}`)
  }
  const [barTime, open, high, low, close, volume, provider, providerDetail, sourceUrl, fetchedAt] = value
  return {
    ticker,
    timeframe: "1D",
    bar_time: String(barTime || ""),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    provider: String(provider || ""),
    provider_detail: String(providerDetail || ""),
    source_url: String(sourceUrl || ""),
    fetched_at: String(fetchedAt || ""),
  }
}

export function decodeGroupedDailyOhlcvResponse(data: unknown, expectedTickers: string[]) {
  const expected = [...new Set(expectedTickers.map((ticker) => normalizeTicker(ticker)).filter(Boolean))]
  const expectedSet = new Set(expected)
  const result = new Map<string, GroupedDailyOhlcvRow[]>()

  if (!Array.isArray(data)) throw new Error("OHLCV_GROUPED_RESPONSE_INVALID")

  for (const item of data as GroupedRecentOhlcvPayload[]) {
    const ticker = normalizeTicker(item?.ticker)
    if (!expectedSet.has(ticker) || result.has(ticker)) {
      throw new Error(`OHLCV_GROUPED_TICKER_INVALID: ${ticker || "missing"}`)
    }
    if (!Array.isArray(item.rows)) throw new Error(`OHLCV_GROUPED_ROWS_INVALID: ${ticker}`)
    result.set(ticker, item.rows.map((row) => decodeCompactDailyRow(ticker, row)))
  }

  const missing = expected.filter((ticker) => !result.has(ticker))
  if (missing.length) throw new Error(`OHLCV_GROUPED_RESPONSE_INCOMPLETE: missing=${missing.join(",")}`)
  return result
}
