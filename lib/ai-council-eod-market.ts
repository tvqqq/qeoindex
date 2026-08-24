import type { CouncilRatingEvidence } from "@/lib/ai-council-model"

export const AI_COUNCIL_EOD_MARKET_VERSION = "eod-market-overlay-v1"

const EOD_FINAL_HOUR_UTC = 7
const EOD_FINAL_MINUTE_UTC = 50

export interface AiCouncilEodMarketSnapshot {
  symbol: string
  session_date: string
  reference_price: number | string | null
  latest_price: number | string | null
  total_volume: number | string | null
  updated_at: string | null
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

function cutoffUtc(sessionDate: string) {
  return new Date(`${sessionDate}T00:00:00.000Z`).getTime()
    + EOD_FINAL_HOUR_UTC * 60 * 60 * 1000
    + EOD_FINAL_MINUTE_UTC * 60 * 1000
}

export function isFinalCouncilEodSnapshot(snapshot: AiCouncilEodMarketSnapshot, expectedSessionDate: string) {
  if (snapshot.session_date !== expectedSessionDate || !snapshot.updated_at) return false
  const updatedAt = new Date(snapshot.updated_at).getTime()
  return Number.isFinite(updatedAt) && updatedAt >= cutoffUtc(expectedSessionDate)
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
