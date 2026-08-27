import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getAiCouncilData,
  type AiCouncilData,
  type AiCouncilStockSnapshot,
} from "@/lib/ai-council-data"
import {
  AI_COUNCIL_EOD_MARKET_VERSION,
  overlayCouncilRatingWithEodSnapshot,
  type AiCouncilEodMarketSnapshot,
} from "@/lib/ai-council-eod-market"
import { buildCouncilStock } from "@/lib/ai-council-model"

export const AI_COUNCIL_EOD_DATA_VERSION = "ai-council-eod-data-v1"

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function eodEvidenceHash(baseEvidenceHash: string, overlay: {
  sessionDate: string | null
  price: number | null
  referencePrice: number | null
  volume: number | null
}) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      version: AI_COUNCIL_EOD_DATA_VERSION,
      baseEvidenceHash,
      eodMarketOverlay: overlay,
    })), "utf8")
    .digest("hex")
}

export async function getAiCouncilEodData(
  supabase: SupabaseClient,
  options: { includeHistory?: boolean; includePromptEvidence?: boolean; ratingDate?: string } = {},
): Promise<AiCouncilData> {
  // Operational EOD rebuild always needs the normalized rating + Wyckoff inputs so the
  // deterministic agents can be recomputed after replacing final-session price direction/volume.
  const base = await getAiCouncilData(supabase, {
    includeHistory: options.includeHistory,
    includePromptEvidence: true,
    ratingDate: options.ratingDate,
  })
  if (!base.ratingDate || !base.stocks.length) return base

  const tickers = base.stocks.map((stock) => stock.ticker)
  const marketResult = await supabase
    .from("stock_orderbook_snapshots")
    .select("symbol,session_date,reference_price,latest_price,total_volume,updated_at")
    .eq("session_date", base.ratingDate)
    .in("symbol", tickers)

  if (marketResult.error) {
    throw new Error(`Load Council EOD market overlay failed: ${marketResult.error.message}`)
  }

  const marketByTicker = new Map(
    ((marketResult.data || []) as AiCouncilEodMarketSnapshot[])
      .map((row) => [row.symbol.trim().toUpperCase(), row] as const),
  )
  let appliedCount = 0

  const stocks: AiCouncilStockSnapshot[] = base.stocks.map((stock) => {
    const promptEvidence = stock.promptEvidence
    if (!promptEvidence) return stock

    const overlay = overlayCouncilRatingWithEodSnapshot(
      promptEvidence.rating,
      marketByTicker.get(stock.ticker.trim().toUpperCase()),
      base.ratingDate!,
    )
    if (!overlay.applied) {
      if (options.includePromptEvidence) return stock
      const { promptEvidence: _promptEvidence, ...rest } = stock
      return rest
    }

    appliedCount += 1
    const evidenceHash = eodEvidenceHash(stock.evidenceHash, {
      sessionDate: overlay.source.sessionDate,
      price: overlay.source.price,
      referencePrice: overlay.source.referencePrice,
      volume: overlay.source.volume,
    })
    const rebuilt = buildCouncilStock(overlay.rating, promptEvidence.snapshots)
    const rebuiltPromptEvidence = {
      ...promptEvidence,
      rating: overlay.rating,
      evidenceHash,
    }

    return {
      ...rebuilt,
      evidenceHash,
      ...(options.includePromptEvidence ? { promptEvidence: rebuiltPromptEvidence } : {}),
    }
  })

  return {
    ...base,
    stocks,
    message: `${base.message} EOD market overlay ${AI_COUNCIL_EOD_MARKET_VERSION}: ${appliedCount}/${base.stocks.length} final-session stocks rebuilt; TTAI/KFSP proprietary scores and non-EOD metrics remain provider observations.`,
  }
}
