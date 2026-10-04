export const MARKET_DEPTH_BUCKETS = [
  { label: "≤−7%", tone: "down" },
  { label: "−7~−5%", tone: "down" },
  { label: "−5~−3%", tone: "down" },
  { label: "−3~−1%", tone: "down" },
  { label: "−1~0%", tone: "down" },
  { label: "0%", tone: "flat" },
  { label: "0~1%", tone: "up" },
  { label: "1~3%", tone: "up" },
  { label: "3~5%", tone: "up" },
  { label: "5~7%", tone: "up" },
  { label: "≥7%", tone: "up" },
] as const

export type MarketDepthQuote = {
  price?: number | null
  volume?: number | null
  changePercent?: number | null
  updatedAt?: string | null
}

export type MarketDepthStock = {
  ticker: string
  exchange?: string | null
}

export type MarketDepthSnapshot = {
  bins: number[]
  total: number
  covered: number
  missing: number
  advancers: number
  decliners: number
  unchanged: number
  asOf: string | null
}

export function marketDepthBucketIndex(changePercent: number): number {
  if (changePercent <= -7) return 0
  if (changePercent <= -5) return 1
  if (changePercent <= -3) return 2
  if (changePercent <= -1) return 3
  if (changePercent < 0) return 4
  if (changePercent === 0) return 5
  if (changePercent <= 1) return 6
  if (changePercent <= 3) return 7
  if (changePercent <= 5) return 8
  if (changePercent < 7) return 9
  return 10
}

// Display only actual current-session prices from the subscribed canonical
// Top-200 universe. This is NOT a reconstructed full-HOSE histogram.
export function buildMarketDepthSnapshot(
  stocks: readonly MarketDepthStock[],
  quotes: Readonly<Record<string, MarketDepthQuote | undefined>>,
  sessionDate: string,
  sessionDateForTimestamp: (timestamp: string) => string | null,
): MarketDepthSnapshot {
  const bins = Array<number>(MARKET_DEPTH_BUCKETS.length).fill(0)
  const seen = new Set<string>()
  let total = 0
  let covered = 0
  let advancers = 0
  let decliners = 0
  let unchanged = 0
  let asOf: string | null = null

  for (const stock of stocks) {
    if (stock.exchange?.trim().toUpperCase() !== "HOSE") continue
    const ticker = stock.ticker.trim().toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    total += 1

    const quote = quotes[ticker]
    const pct = quote?.changePercent
    const updatedAt = quote?.updatedAt
    if (!quote
      || typeof quote.price !== "number"
      || !Number.isFinite(quote.price)
      || quote.price <= 0
      // Broker SSR may substitute the reference price for an untraded ticker.
      // Require actual matched volume before counting it as a priced stock.
      || typeof quote.volume !== "number"
      || !Number.isFinite(quote.volume)
      || quote.volume <= 0
      || typeof pct !== "number"
      || !Number.isFinite(pct)
      || !updatedAt
      || !sessionDate
      || sessionDateForTimestamp(updatedAt) !== sessionDate) continue

    bins[marketDepthBucketIndex(pct)] += 1
    covered += 1
    if (pct > 0) advancers += 1
    else if (pct < 0) decliners += 1
    else unchanged += 1
    if (!asOf || updatedAt > asOf) asOf = updatedAt
  }

  return { bins, total, covered, missing: total - covered, advancers, decliners, unchanged, asOf }
}
