export const MARKET_CONTEXT_INDEX_SYMBOLS = ["VNINDEX", "VN30"] as const

export type MarketContextIndexSymbol = (typeof MARKET_CONTEXT_INDEX_SYMBOLS)[number]

export type MarketContextPoint = {
  time: number
  value: number
}

export type MarketContextIndexSeries = {
  symbol: MarketContextIndexSymbol
  sessionDate: string
  points: MarketContextPoint[]
  asOf: string
  source: string
}

export type MarketImpactEntry = {
  symbol: string
  contribution: number
  asOf: string | null
}

export type MarketImpactSnapshot = {
  source: string
  scope: "VNINDEX"
  asOf: string | null
  providerRows: number
  finiteRows: number
  positive: MarketImpactEntry[]
  negative: MarketImpactEntry[]
  displayedPositiveTotal: number
  displayedNegativeTotal: number
  displayedNetTotal: number
}

export type MarketBoardContextBootstrap = {
  generatedAt: string
  indexes: Partial<Record<MarketContextIndexSymbol, MarketContextIndexSeries>>
  impact: MarketImpactSnapshot | null
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isIndexSeries(value: unknown): value is MarketContextIndexSeries {
  if (!isRecord(value)) return false
  if (!MARKET_CONTEXT_INDEX_SYMBOLS.includes(value.symbol as MarketContextIndexSymbol)) return false
  if (typeof value.sessionDate !== "string" || typeof value.asOf !== "string" || typeof value.source !== "string") return false
  if (!Array.isArray(value.points)) return false
  return value.points.every((point) => {
    if (!isRecord(point)) return false
    return Number.isFinite(Number(point.time)) && Number.isFinite(Number(point.value)) && Number(point.value) > 0
  })
}

export function isMarketBoardContextBootstrap(value: unknown): value is MarketBoardContextBootstrap {
  if (!isRecord(value)) return false
  if (typeof value.generatedAt !== "string" || !Array.isArray(value.errors)) return false
  if (!isRecord(value.indexes)) return false
  for (const symbol of MARKET_CONTEXT_INDEX_SYMBOLS) {
    const series = value.indexes[symbol]
    if (series !== undefined && !isIndexSeries(series)) return false
  }
  if (value.impact !== null && value.impact !== undefined && !isRecord(value.impact)) return false
  return true
}
