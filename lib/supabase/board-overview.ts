import "server-only"

import {
  normalizeForeignFlow,
  normalizeToKiloPrice,
  normalizeVolume,
} from "@/lib/market-data-contract"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export interface BoardOverviewRow {
  symbol: string
  session_date: string
  reference_price: number | null
  ceiling_price: number | null
  floor_price: number | null
  latest_price: number | null
  total_volume: number
  intraday_1m: unknown[]
  foreign_flow: ReturnType<typeof normalizeForeignFlow>
  updated_at: string
}

function normalizeIntradayBars(bars: unknown[]) {
  if (!Array.isArray(bars)) return []
  return bars.flatMap((bar: unknown) => {
    if (!bar || typeof bar !== "object") return []
    const value = bar as Record<string, unknown>
    const rawOpen = Number(value.open ?? value.o ?? value.close ?? value.c ?? 0)
    const rawClose = Number(value.close ?? value.c ?? rawOpen)
    const open = normalizeToKiloPrice(rawOpen)
    const close = normalizeToKiloPrice(rawClose)
    if (!close || close <= 0) return []
    return [{ ...value, open: open ?? close, close }]
  })
}

export async function getCanonicalBoardOverviewSnapshots(
  symbols: readonly string[],
): Promise<Record<string, BoardOverviewRow>> {
  const client = getSupabaseServerClient()
  if (!client) return {}

  const normalizedSymbols = [...new Set(symbols
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{2,12}$/.test(symbol)))]
    .slice(0, 200)
  if (!normalizedSymbols.length) return {}

  try {
    const { data, error } = await client
      .from("stock_orderbook_snapshots")
      .select("symbol, session_date, reference_price, ceiling_price, floor_price, latest_price, total_volume, intraday_1m, foreign_flow, updated_at")
      .in("symbol", normalizedSymbols)

    if (error || !data) return {}

    const result: Record<string, BoardOverviewRow> = {}
    for (const rawRow of data as Array<Record<string, unknown>>) {
      const symbol = String(rawRow.symbol || "").toUpperCase()
      if (!normalizedSymbols.includes(symbol)) continue
      const reference = normalizeToKiloPrice(Number(rawRow.reference_price))
      const latest = normalizeToKiloPrice(Number(rawRow.latest_price)) || reference
      result[symbol] = {
        symbol,
        session_date: String(rawRow.session_date || ""),
        reference_price: reference,
        ceiling_price: normalizeToKiloPrice(Number(rawRow.ceiling_price)) || (reference ? Math.round(reference * 1.07 * 100) / 100 : null),
        floor_price: normalizeToKiloPrice(Number(rawRow.floor_price)) || (reference ? Math.round(reference * 0.93 * 100) / 100 : null),
        latest_price: latest,
        total_volume: normalizeVolume(Number(rawRow.total_volume ?? 0)),
        intraday_1m: normalizeIntradayBars(Array.isArray(rawRow.intraday_1m) ? rawRow.intraday_1m : []),
        foreign_flow: normalizeForeignFlow(rawRow.foreign_flow, latest),
        updated_at: String(rawRow.updated_at || ""),
      }
    }
    return result
  } catch (error) {
    console.warn("[Board Overview] Failed to read canonical snapshots:", error)
    return {}
  }
}
