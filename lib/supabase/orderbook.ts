import { getSupabaseServerClient } from "@/lib/supabase/server"
import type { DnseSessionHistory } from "@/lib/dnse-market-runtime"
import {
  normalizeToKiloPrice,
  normalizeVolume,
  normalizeTradeSide,
  formatSessionTradeTime,
  normalizeDepthLevels,
  normalizeForeignFlow,
  toCanonicalOrderbookSnapshot,
  type CanonicalOrderbookSnapshot,
} from "@/lib/market-data-contract"

export { normalizeToKiloPrice, normalizeVolume, normalizeTradeSide, formatSessionTradeTime }

export interface StoredOrderbookRow {
  symbol: string
  session_date: string
  reference_price: number | null
  ceiling_price: number | null
  floor_price: number | null
  latest_price: number | null
  total_volume: number
  intraday_1m: unknown[]
  trades: unknown[]
  trades_truncated: boolean
  latest_quote: Record<string, unknown>
  foreign_flow: Record<string, unknown>
  put_through: unknown[]
  updated_at: string
}

function normalizeIntradayBars(bars: unknown[]): Array<{ time: number; open: number; close: number }> {
  if (!Array.isArray(bars)) return []
  return bars.map((b: any) => {
    const rawOpen = typeof b.open === "number" ? b.open : typeof b.c === "number" ? b.c : 0
    const rawClose = typeof b.close === "number" ? b.close : typeof b.c === "number" ? b.c : rawOpen
    const tNum = Number(b.time || b.t || 0)
    return {
      time: tNum,
      open: normalizeToKiloPrice(rawOpen) ?? 0,
      close: normalizeToKiloPrice(rawClose) ?? 0,
    }
  }).filter((b) => b.close > 0)
}

function normalizeTrades(trades: unknown[]): Array<{ id: string; time: number; price: number; volume: number; side: string }> {
  if (!Array.isArray(trades)) return []
  return trades.map((t: any, idx: number) => {
    const timeStr = formatSessionTradeTime(t.time)
    const [hh, mm, ss] = timeStr.split(":").map(Number)
    const secOfDay = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)
    return {
      id: String(t.id || t.transId || `t-${idx}`),
      time: typeof t.time === "number" && t.time < 86400 ? t.time : secOfDay,
      price: normalizeToKiloPrice(t.price) ?? 0,
      volume: normalizeVolume(t.volume || t.lastVol),
      side: normalizeTradeSide(t.side, t.cl),
    }
  }).filter((t) => t.price > 0)
}

export async function getOrderbookSnapshotFromSupabase(symbol: string): Promise<DnseSessionHistory | null> {
  const client = getSupabaseServerClient()
  if (!client) return null

  try {
    const { data, error } = await client
      .from("stock_orderbook_snapshots")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .single()

    if (error || !data) return null

    const canonical = toCanonicalOrderbookSnapshot(symbol, data)

    return {
      symbol: canonical.symbol,
      sessionStart: Math.floor(Date.now() / 1000),
      generatedAt: canonical.updatedAt,
      prices: canonical.intraday1m.map((p) => ({
        time: typeof p.time === "number" ? p.time : Math.floor(Date.now() / 1000),
        open: p.open,
        close: p.close,
      })),
      trades: canonical.trades.map((t) => {
        const [hh, mm, ss] = t.time.split(":").map(Number)
        return {
          id: t.id,
          time: (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0),
          price: t.price,
          volume: t.volume,
          side: t.side,
        }
      }),
      tradesTruncated: canonical.tradesTruncated,
      latestQuote: {
        reference: canonical.referencePrice,
        ceiling: canonical.ceilingPrice,
        floor: canonical.floorPrice,
        matchPrice: canonical.latestPrice,
        openPrice: canonical.latestQuote.openPrice,
        highPrice: canonical.latestQuote.highPrice,
        lowPrice: canonical.latestQuote.lowPrice,
        avgPrice: canonical.latestQuote.avgPrice,
        totalVolume: canonical.totalVolume,
        bid: canonical.latestQuote.bids,
        offer: canonical.latestQuote.asks,
        time: Math.floor(Date.now() / 1000),
      },
      foreign: canonical.foreignFlow as any,
      putThrough: canonical.putThrough as any,
    }
  } catch (error) {
    console.warn(`[Supabase Orderbook] Failed to read ${symbol}:`, error)
    return null
  }
}

export async function getAllOrderbookSnapshotsFromSupabase(): Promise<Record<string, StoredOrderbookRow>> {
  const client = getSupabaseServerClient()
  if (!client) return {}

  try {
    const { data, error } = await client
      .from("stock_orderbook_snapshots")
      .select("*")

    if (error || !data) return {}

    const result: Record<string, StoredOrderbookRow> = {}
    for (const rawRow of data as StoredOrderbookRow[]) {
      if (rawRow.symbol) {
        const sym = rawRow.symbol.toUpperCase()
        const canonical = toCanonicalOrderbookSnapshot(sym, rawRow)
        result[sym] = {
          symbol: canonical.symbol,
          session_date: canonical.sessionDate,
          reference_price: canonical.referencePrice,
          ceiling_price: canonical.ceilingPrice,
          floor_price: canonical.floorPrice,
          latest_price: canonical.latestPrice,
          total_volume: canonical.totalVolume,
          intraday_1m: canonical.intraday1m,
          trades: canonical.trades,
          trades_truncated: canonical.tradesTruncated,
          latest_quote: canonical.latestQuote as any,
          foreign_flow: canonical.foreignFlow as any,
          put_through: canonical.putThrough,
          updated_at: canonical.updatedAt,
        }
      }
    }
    return result
  } catch (error) {
    console.warn("[Supabase Orderbook] Failed to read all snapshots:", error)
    return {}
  }
}

export async function upsertOrderbookSnapshotToSupabase(history: DnseSessionHistory): Promise<boolean> {
  const client = getSupabaseServerClient()
  if (!client) return false

  try {
    const canonical = toCanonicalOrderbookSnapshot(history.symbol, {
      ...history,
      latest_quote: history.latestQuote,
      foreign_flow: history.foreign,
      put_through: history.putThrough,
    })

    const payload = {
      symbol: canonical.symbol,
      session_date: canonical.sessionDate,
      reference_price: canonical.referencePrice,
      ceiling_price: canonical.ceilingPrice,
      floor_price: canonical.floorPrice,
      latest_price: canonical.latestPrice,
      total_volume: canonical.totalVolume,
      intraday_1m: canonical.intraday1m,
      trades: canonical.trades,
      trades_truncated: canonical.tradesTruncated,
      latest_quote: canonical.latestQuote,
      foreign_flow: canonical.foreignFlow,
      put_through: canonical.putThrough,
      updated_at: canonical.updatedAt,
    }

    const { error } = await client
      .from("stock_orderbook_snapshots")
      .upsert(payload, { onConflict: "symbol" })

    if (error) {
      console.warn(`[Supabase Orderbook] Upsert error for ${history.symbol}:`, error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn(`[Supabase Orderbook] Failed to write ${history.symbol}:`, error)
    return false
  }
}

export async function batchUpsertOrderbookSnapshotsToSupabase(histories: DnseSessionHistory[]): Promise<number> {
  const client = getSupabaseServerClient()
  if (!client || histories.length === 0) return 0

  try {
    const records = histories.map((history) => {
      const canonical = toCanonicalOrderbookSnapshot(history.symbol, {
        ...history,
        latest_quote: history.latestQuote,
        foreign_flow: history.foreign,
        put_through: history.putThrough,
      })

      return {
        symbol: canonical.symbol,
        session_date: canonical.sessionDate,
        reference_price: canonical.referencePrice,
        ceiling_price: canonical.ceilingPrice,
        floor_price: canonical.floorPrice,
        latest_price: canonical.latestPrice,
        total_volume: canonical.totalVolume,
        intraday_1m: canonical.intraday1m,
        trades: canonical.trades,
        trades_truncated: canonical.tradesTruncated,
        latest_quote: canonical.latestQuote,
        foreign_flow: canonical.foreignFlow,
        put_through: canonical.putThrough,
        updated_at: canonical.updatedAt,
      }
    })

    const { error } = await client
      .from("stock_orderbook_snapshots")
      .upsert(records, { onConflict: "symbol" })

    if (error) {
      console.warn("[Supabase Orderbook] Batch upsert error:", error.message)
      return 0
    }
    return records.length
  } catch (error) {
    console.warn("[Supabase Orderbook] Failed batch write:", error)
    return 0
  }
}
