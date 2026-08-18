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

    return {
      symbol: row.symbol,
      sessionStart,
      generatedAt: row.updated_at,
      prices: Array.isArray(row.intraday_1m) ? (row.intraday_1m as any) : [],
      trades: Array.isArray(row.trades) ? (row.trades as any) : [],
      tradesTruncated: Boolean(row.trades_truncated),
      latestQuote: (row.latest_quote as any) ?? null,
      foreign: (row.foreign_flow as any) ?? null,
      putThrough: Array.isArray(row.put_through) ? (row.put_through as any) : [],
    }
  } catch (error) {
    console.warn(`[Supabase Orderbook] Failed to read ${symbol}:`, error)
    return null
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

    const payload = {
      symbol: history.symbol.toUpperCase(),
      session_date: today,
      reference_price: history.latestQuote?.reference ?? null,
      ceiling_price: history.latestQuote?.ceiling ?? null,
      floor_price: history.latestQuote?.floor ?? null,
      latest_price: history.latestQuote?.matchPrice ?? null,
      total_volume: history.latestQuote?.totalVolume ?? 0,
      intraday_1m: history.prices ?? [],
      trades: history.trades ?? [],
      trades_truncated: history.tradesTruncated ?? false,
      latest_quote: history.latestQuote ?? {},
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
