export const MARKET_UNIVERSE_KEY = "vn_top_stocks" as const
export const MARKET_UNIVERSE_MAX_SIZE = 200 as const

export interface MarketUniverseSelectionRow {
  ticker: string
  companyName: string | null
  exchange: string | null
  sector: string | null
  marketCapBillion: number
  averageVolume50d: number
  sourceAsOfDate: string
}

export interface MarketUniverseSelectionFilters {
  minMarketCapBillion: number
  minAverageVolume50d: number
  maxSize?: number
}

export interface SelectedMarketUniverseRow extends MarketUniverseSelectionRow {
  rank: number
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function selectMarketUniverse(
  rows: readonly MarketUniverseSelectionRow[],
  filters: MarketUniverseSelectionFilters,
): SelectedMarketUniverseRow[] {
  const minMarketCapBillion = finitePositive(filters.minMarketCapBillion)
  const minAverageVolume50d = finitePositive(filters.minAverageVolume50d)
  if (minMarketCapBillion == null || minAverageVolume50d == null) {
    throw new Error("Market universe filters must be positive finite numbers")
  }

  const requestedMax = Number(filters.maxSize ?? MARKET_UNIVERSE_MAX_SIZE)
  const maxSize = Math.max(1, Math.min(MARKET_UNIVERSE_MAX_SIZE, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : MARKET_UNIVERSE_MAX_SIZE))

  const normalized = rows.flatMap((row) => {
    const ticker = String(row.ticker || "").trim().toUpperCase()
    const marketCapBillion = finitePositive(row.marketCapBillion)
    const averageVolume50d = finitePositive(row.averageVolume50d)
    if (!/^[A-Z0-9]{2,12}$/.test(ticker) || marketCapBillion == null || averageVolume50d == null) return []
    if (!(marketCapBillion > minMarketCapBillion) || !(averageVolume50d > minAverageVolume50d)) return []
    return [{
      ticker,
      companyName: row.companyName ? String(row.companyName) : null,
      exchange: row.exchange ? String(row.exchange).toUpperCase() : null,
      sector: row.sector ? String(row.sector) : null,
      marketCapBillion,
      averageVolume50d,
      sourceAsOfDate: String(row.sourceAsOfDate),
    }]
  })

  const deduped = [...new Map(normalized.map((row) => [row.ticker, row])).values()]
    .sort((left, right) =>
      right.marketCapBillion - left.marketCapBillion
      || right.averageVolume50d - left.averageVolume50d
      || left.ticker.localeCompare(right.ticker),
    )
    .slice(0, maxSize)

  return deduped.map((row, index) => ({ ...row, rank: index + 1 }))
}
