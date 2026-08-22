import { CANONICAL_TOP100_TICKERS } from "../supabase/functions/_shared/kfsp-catalog.ts"

export interface UniverseStock {
  ticker: string
  rank: number
  marketCapT: number
  exchange: "HOSE"
}

export const UNIVERSE_DATE = "2026-08-17"
export const UNIVERSE_SIZE = 100

export const CANONICAL_UNIVERSE_TICKERS = CANONICAL_TOP100_TICKERS

export const CANONICAL_UNIVERSE_STOCKS: UniverseStock[] = CANONICAL_UNIVERSE_TICKERS.map((ticker, index) => ({
  ticker,
  rank: index + 1,
  marketCapT: 50,
  exchange: "HOSE" as const,
}))
