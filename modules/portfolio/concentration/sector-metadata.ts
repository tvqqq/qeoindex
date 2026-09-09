import "server-only"

import { getCanonicalUniverse } from "@/modules/market/universe"

export type SectorMetadataSnapshot = {
  source: "canonical_market_universe"
  sourceAsOfDate: string | null
  byTicker: Record<string, string | null>
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase()
}

export async function loadStructuredSectorMetadata(
  tickers: readonly string[] = [],
): Promise<SectorMetadataSnapshot> {
  const wanted = new Set(tickers.map(normalizeTicker).filter(Boolean))
  const byTicker: Record<string, string | null> = {}
  for (const ticker of wanted) byTicker[ticker] = null

  try {
    const snapshot = await getCanonicalUniverse()
    for (const stock of snapshot.stocks) {
      const ticker = normalizeTicker(stock.ticker)
      if (wanted.size > 0 && !wanted.has(ticker)) continue
      byTicker[ticker] = stock.sector?.trim() || null
    }
    for (const ticker of wanted) byTicker[ticker] ??= null
    return {
      source: "canonical_market_universe",
      sourceAsOfDate: snapshot.sourceAsOfDate || null,
      byTicker,
    }
  } catch {
    for (const ticker of wanted) byTicker[ticker] ??= null
    return {
      source: "canonical_market_universe",
      sourceAsOfDate: null,
      byTicker,
    }
  }
}
