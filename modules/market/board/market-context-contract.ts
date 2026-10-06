const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function currentSessionIndexMetrics(
  quote: { sourceAsOf?: string; updatedAt?: string; volume?: number; valueTraded?: number } | undefined,
  sessionDate: string,
) {
  const asOf = quote?.sourceAsOf ?? ""
  const timestamp = Date.parse(asOf)
  if (!sessionDate || !Number.isFinite(timestamp) || VIETNAM_DATE_FORMATTER.format(new Date(timestamp)) !== sessionDate) {
    return { asOf: "", volume: undefined, valueTraded: undefined }
  }
  return {
    asOf,
    volume: typeof quote?.volume === "number" && Number.isFinite(quote.volume) && quote.volume >= 0 ? quote.volume : undefined,
    valueTraded: typeof quote?.valueTraded === "number" && Number.isFinite(quote.valueTraded) && quote.valueTraded >= 0 ? quote.valueTraded : undefined,
  }
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

export function coveredTop200ForeignTotals(snapshot: { buy: number; sell: number; covered: number } | undefined) {
  if (
    !snapshot
    || !Number.isFinite(snapshot.covered)
    || snapshot.covered <= 0
    || !Number.isFinite(snapshot.buy)
    || !Number.isFinite(snapshot.sell)
    || snapshot.buy < 0
    || snapshot.sell < 0
  ) return null
  return { buy: snapshot.buy, sell: snapshot.sell, net: snapshot.buy - snapshot.sell }
}

export function selectCurrentSessionImpact(
  rest: MarketImpactSnapshot | null | undefined,
  realtime: MarketImpactSnapshot | null | undefined,
  sessionDate: string,
  nowMs: number,
  maxAgeMs = 120_000,
): { impact: MarketImpactSnapshot | null; source: "websocket" | "rest" | null } {
  const isCurrentSession = (impact: MarketImpactSnapshot | null | undefined) => {
    const timestamp = Date.parse(impact?.asOf ?? "")
    return Boolean(
      sessionDate
      && Number.isFinite(timestamp)
      && timestamp <= nowMs + 5_000
      && nowMs - timestamp <= maxAgeMs
      && VIETNAM_DATE_FORMATTER.format(new Date(timestamp)) === sessionDate,
    )
  }
  if (isCurrentSession(realtime)) return { impact: realtime ?? null, source: "websocket" }
  const restTime = Date.parse(rest?.asOf ?? "")
  if (rest && sessionDate && Number.isFinite(restTime) && VIETNAM_DATE_FORMATTER.format(new Date(restTime)) === sessionDate) {
    return { impact: rest, source: "rest" }
  }
  return { impact: null, source: null }
}

// Keep strongest positive at the far left, strongest negative at the far right.
// Only reorders displayed provider contributions; does not change their totals.
export function orderedImpactBars(impact: Pick<MarketImpactSnapshot, "positive" | "negative">): MarketImpactEntry[] {
  return [
    ...[...impact.positive].sort((a, b) => b.contribution - a.contribution),
    ...[...impact.negative].sort((a, b) => b.contribution - a.contribution),
  ]
}

export type MarketBoardContextBootstrap = {
  generatedAt: string
  impact: MarketImpactSnapshot | null
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function rowsFromImpactPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  for (const key of ["rows", "data", "result", "items"]) {
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
    .slice(0, 5)
  const negative = entries
    .filter((entry) => entry.contribution < 0)
    .sort((left, right) => left.contribution - right.contribution)
    .slice(0, 5)
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

export function isMarketBoardContextBootstrap(value: unknown): value is MarketBoardContextBootstrap {
  if (!isRecord(value)) return false
  if (typeof value.generatedAt !== "string" || !Array.isArray(value.errors)) return false
  if (value.impact !== null && value.impact !== undefined && !isRecord(value.impact)) return false
  return true
}
