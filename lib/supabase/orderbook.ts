import { getSupabaseServerClient } from "@/lib/supabase/server"
import type { DnseSessionHistory } from "@/lib/dnse-market-runtime"

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

/**
 * Universal Price Normalizer for Vietnamese Stocks.
 * Strictly enforces frontend convention in thousands (nghìn đồng):
 * e.g. 21.85 (NOT 21850.00), 17.60 (NOT 17600.00), 145.60 (NOT 145600.00).
 */
export function normalizeToKiloPrice(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const normalized = price >= 500 ? price / 1000 : price
  return Math.round(normalized * 100) / 100
}

function normalizeIntradayBars(bars: unknown[]): Array<{ time: number; open: number; close: number }> {
  if (!Array.isArray(bars)) return []
  return bars.map((b: any) => {
    const rawOpen = typeof b.open === "number" ? b.open : typeof b.c === "number" ? b.c : 0
    const rawClose = typeof b.close === "number" ? b.close : typeof b.c === "number" ? b.c : rawOpen
    return {
      time: Number(b.time || b.t || 0),
      open: normalizeToKiloPrice(rawOpen) ?? 0,
      close: normalizeToKiloPrice(rawClose) ?? 0,
    }
  }).filter((b) => b.close > 0)
}

function normalizeTrades(trades: unknown[]): Array<{ id: string; time: number; price: number; volume: number; side: string }> {
  if (!Array.isArray(trades)) return []
  return trades.map((t: any, idx: number) => ({
    id: String(t.id || t.transId || `t-${idx}`),
    time: Number(t.time || 0),
    price: normalizeToKiloPrice(t.price) ?? 0,
    volume: Number(t.volume || t.lastVol || 0),
    side: String(t.side || "REF").toUpperCase(),
  })).filter((t) => t.price > 0)
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

    const row = data as StoredOrderbookRow
    const sessionStart = row.intraday_1m?.[0] ? Number((row.intraday_1m[0] as any).time) : Math.floor(Date.now() / 1000)

    const normRef = normalizeToKiloPrice(row.reference_price)
    const normCeil = normalizeToKiloPrice(row.ceiling_price)
    const normFloor = normalizeToKiloPrice(row.floor_price)
    const normLast = normalizeToKiloPrice(row.latest_price)

    return {
      symbol: row.symbol,
      sessionStart,
      generatedAt: row.updated_at,
      prices: normalizeIntradayBars(row.intraday_1m as unknown[]),
      trades: normalizeTrades(row.trades as unknown[]),
      tradesTruncated: Boolean(row.trades_truncated),
      latestQuote: {
        ...(row.latest_quote as any ?? {}),
        reference: normRef,
        ceiling: normCeil,
        floor: normFloor,
        matchPrice: normLast,
      },
      foreign: (row.foreign_flow as any) ?? null,
      putThrough: Array.isArray(row.put_through) ? (row.put_through as any) : [],
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
        result[sym] = {
          ...rawRow,
          reference_price: normalizeToKiloPrice(rawRow.reference_price),
          ceiling_price: normalizeToKiloPrice(rawRow.ceiling_price),
          floor_price: normalizeToKiloPrice(rawRow.floor_price),
          latest_price: normalizeToKiloPrice(rawRow.latest_price),
          intraday_1m: normalizeIntradayBars(rawRow.intraday_1m as unknown[]),
          trades: normalizeTrades(rawRow.trades as unknown[]),
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
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    const ref = normalizeToKiloPrice(history.latestQuote?.reference)
    const ceil = normalizeToKiloPrice(history.latestQuote?.ceiling)
    const floor = normalizeToKiloPrice(history.latestQuote?.floor)
    const last = normalizeToKiloPrice(history.latestQuote?.matchPrice)

    const payload = {
      symbol: history.symbol.toUpperCase(),
      session_date: today,
      reference_price: ref,
      ceiling_price: ceil,
      floor_price: floor,
      latest_price: last,
      total_volume: history.latestQuote?.totalVolume ?? 0,
      intraday_1m: normalizeIntradayBars(history.prices ?? []),
      trades: normalizeTrades(history.trades ?? []),
      trades_truncated: history.tradesTruncated ?? false,
      latest_quote: {
        ...(history.latestQuote ?? {}),
        reference: ref,
        ceiling: ceil,
        floor: floor,
        matchPrice: last,
      },
      foreign_flow: history.foreign ?? {},
      put_through: history.putThrough ?? [],
      updated_at: new Date().toISOString(),
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
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    const records = histories.map((history) => {
      const ref = normalizeToKiloPrice(history.latestQuote?.reference)
      const ceil = normalizeToKiloPrice(history.latestQuote?.ceiling)
      const floor = normalizeToKiloPrice(history.latestQuote?.floor)
      const last = normalizeToKiloPrice(history.latestQuote?.matchPrice)

      return {
        symbol: history.symbol.toUpperCase(),
        session_date: today,
        reference_price: ref,
        ceiling_price: ceil,
        floor_price: floor,
        latest_price: last,
        total_volume: history.latestQuote?.totalVolume ?? 0,
        intraday_1m: normalizeIntradayBars(history.prices ?? []),
        trades: normalizeTrades(history.trades ?? []),
        trades_truncated: history.tradesTruncated ?? false,
        latest_quote: {
          ...(history.latestQuote ?? {}),
          reference: ref,
          ceiling: ceil,
          floor: floor,
          matchPrice: last,
        },
        foreign_flow: history.foreign ?? {},
        put_through: history.putThrough ?? [],
        updated_at: new Date().toISOString(),
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
