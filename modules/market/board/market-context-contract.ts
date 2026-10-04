export const MARKET_CONTEXT_INDEX_SYMBOLS = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"] as const

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

function rowsFromImpactPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  for (const key of ["data", "result", "items"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[]
  }
  return []
}

function isoFromEpochMilliseconds(milliseconds: number) {
  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function providerTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return isoFromEpochMilliseconds(value > 10_000_000_000 ? value : value * 1000)
  }
  if (!isRecord(value)) return null
  const seconds = Number(value.seconds ?? value.Seconds)
  const nanos = Number(value.nanos ?? value.Nanos ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(nanos)) return null
  return isoFromEpochMilliseconds((seconds + nanos / 1_000_000_000) * 1000)
}

function parseImpactEntry(row: unknown): MarketImpactEntry | null {
  if (!isRecord(row)) return null
  const symbol = String(row.symbol ?? "").trim().toUpperCase()
  const rawContribution = row.basketInfluence
  if (rawContribution === null || rawContribution === undefined || rawContribution === "") return null
  const contribution = Number(rawContribution)
  if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !Number.isFinite(contribution)) return null
  return {
    symbol,
    contribution,
    asOf: providerTimestamp(row.time),
  }
}

export function parseVnindexImpactPayload(payload: unknown): MarketImpactSnapshot | null {
  const rows = rowsFromImpactPayload(payload)
  const entries = rows.map(parseImpactEntry).filter((entry): entry is MarketImpactEntry => Boolean(entry))
  if (!entries.length) return null

  const positive = entries
    .filter((entry) => entry.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 8)
  const negative = entries
    .filter((entry) => entry.contribution < 0)
    .sort((left, right) => left.contribution - right.contribution)
    .slice(0, 8)
  const displayedPositiveTotal = positive.reduce((total, entry) => total + entry.contribution, 0)
  const displayedNegativeTotal = negative.reduce((total, entry) => total + entry.contribution, 0)
  const timestamps = entries
    .map((entry) => entry.asOf)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    source: "DNSE basket-influence · VNINDEX",
    scope: "VNINDEX",
    asOf: timestamps.at(-1) ?? null,
    providerRows: rows.length,
    finiteRows: entries.length,
    positive,
    negative,
    displayedPositiveTotal,
    displayedNegativeTotal,
    displayedNetTotal: displayedPositiveTotal + displayedNegativeTotal,
  }
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
