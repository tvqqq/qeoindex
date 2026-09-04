import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { isVietnamSecuritiesTradingDay, vietnamDateKey } from "@/modules/market/calendar"

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const [rawPrice, rawVolume] = raw.split("|")
  const price = Number(rawPrice ?? 0)
  const volume = Number(rawVolume ?? 0)
  return price > 0 ? { price, volume } : null
}

export async function runMarketUniverseSync() {
  const startedAt = Date.now()
  const now = new Date()
  const today = vietnamDateKey(now)
  if (!isVietnamSecuritiesTradingDay(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "NON_TRADING_DAY",
      sessionDate: today,
      count: 0,
      persistedToSupabase: false,
      persistedCount: 0,
      durationMs: Date.now() - startedAt,
    }
  }

  const universe = await getCanonicalUniverse()
  const tickers = universe.stocks.map((stock) => stock.ticker)
  const tickerSet = new Set(tickers)
  if (!tickers.length) throw new Error("Canonical market universe is empty.")

  const feedUrl = `https://bgapidatafeed.vps.com.vn/getliststockdata/${tickers.join(",")}`
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("Market data provider unavailable.")
  const feedData: unknown = await response.json()
  if (!Array.isArray(feedData) || feedData.length === 0) throw new Error("Market data provider returned no rows.")

  const records: Array<Record<string, unknown>> = []
  for (const rawItem of feedData) {
    const item = rawItem as Record<string, any>
    const symbol = String(item.sym || "").toUpperCase()
    if (!symbol || !tickerSet.has(symbol)) continue
    const ref = Number(item.r || item.closePrice || 0)
    const lastPrice = Number(item.lastPrice ?? item.openPrice ?? ref)
    const ceiling = Number(item.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
    const floor = Number(item.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
    const totalVolume = Number(item.lot || 0) * 10
    const bids = [parseGroupLevel(item.g1), parseGroupLevel(item.g2), parseGroupLevel(item.g3)].filter(Boolean)
    const asks = [parseGroupLevel(item.g4), parseGroupLevel(item.g5), parseGroupLevel(item.g6)].filter(Boolean)
    const nowSeconds = Math.floor(Date.now() / 1000)
    records.push({
      symbol, session_date: today, reference_price: ref > 0 ? ref : null,
      ceiling_price: ceiling > 0 ? ceiling : null, floor_price: floor > 0 ? floor : null,
      latest_price: lastPrice > 0 ? lastPrice : null, total_volume: totalVolume,
      intraday_1m: [{ time: nowSeconds - 3600, open: Number(item.openPrice || ref), close: lastPrice }, { time: nowSeconds, open: lastPrice, close: lastPrice }],
      trades: [], trades_truncated: false,
      latest_quote: { reference: ref, ceiling, floor, matchPrice: lastPrice, openPrice: Number(item.openPrice || ref), highPrice: Number(item.highPrice || lastPrice), lowPrice: Number(item.lowPrice || lastPrice), totalVolume, bids, asks },
      foreign_flow: { totalBuyVolume: Number(item.fBVol || 0) * 10, totalSellVolume: Number(item.fSVolume || 0) * 10, totalBuyValue: Number(item.fBValue || 0) * 1000, totalSellValue: Number(item.fSValue || 0) * 1000, foreignNetVolume: (Number(item.fBVol || 0) - Number(item.fSVolume || 0)) * 10, foreignNetValue: (Number(item.fBValue || 0) - Number(item.fSValue || 0)) * 1000, foreignRoom: Number(item.fRoom || 0) * 10 },
      put_through: [], updated_at: new Date().toISOString(),
    })
  }
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Snapshot storage is not configured.")
  const { error } = await supabase.from("stock_orderbook_snapshots").upsert(records, { onConflict: "symbol" })
  if (error) throw new Error("Snapshot persistence failed.")
  return {
    ok: true,
    skipped: false,
    source: "vps_authoritative_market_feed",
    universeRunId: universe.runId,
    universeCount: tickers.length,
    count: records.length,
    persistedToSupabase: true,
    persistedCount: records.length,
    durationMs: Date.now() - startedAt,
  }
}
