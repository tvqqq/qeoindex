import { NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { CANONICAL_UNIVERSE_TICKERS } from "@/lib/wyckoff-universe"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const parts = raw.split("|")
  const price = Number(parts[0] ?? 0)
  const volume = Number(parts[1] ?? 0)
  return price > 0 ? { price, volume } : null
}

export async function POST(request: Request) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.MARKET_SYNC_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  const feedUrl = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`

  let feedData: unknown = []
  try {
    const response = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return NextResponse.json({ ok: false, message: "Market data provider unavailable." }, { status: 502 })
    }
    feedData = await response.json()
  } catch (error) {
    console.error("[Market Sync] Provider fetch failed", error)
    return NextResponse.json({ ok: false, message: "Market data provider unavailable." }, { status: 502 })
  }

  if (!Array.isArray(feedData) || feedData.length === 0) {
    return NextResponse.json({ ok: false, message: "Market data provider returned no rows." }, { status: 502 })
  }

  const records: Array<Record<string, unknown>> = []
  for (const rawItem of feedData) {
    const item = rawItem as Record<string, any>
    const symbol = String(item.sym || "").toUpperCase()
    if (!symbol || !CANONICAL_UNIVERSE_TICKERS.includes(symbol as (typeof CANONICAL_UNIVERSE_TICKERS)[number])) continue

    const ref = Number(item.r || item.closePrice || 0)
    const lastPrice = Number(item.lastPrice ?? item.openPrice ?? ref)
    const ceiling = Number(item.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
    const floor = Number(item.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
    const totalVolume = Number(item.lot || 0) * 10
    const bids = [parseGroupLevel(item.g1), parseGroupLevel(item.g2), parseGroupLevel(item.g3)].filter(Boolean)
    const asks = [parseGroupLevel(item.g4), parseGroupLevel(item.g5), parseGroupLevel(item.g6)].filter(Boolean)
    const nowSeconds = Math.floor(Date.now() / 1000)

    records.push({
      symbol,
      session_date: today,
      reference_price: ref > 0 ? ref : null,
      ceiling_price: ceiling > 0 ? ceiling : null,
      floor_price: floor > 0 ? floor : null,
      latest_price: lastPrice > 0 ? lastPrice : null,
      total_volume: totalVolume,
      intraday_1m: [
        { time: nowSeconds - 3600, open: Number(item.openPrice || ref), close: lastPrice },
        { time: nowSeconds, open: lastPrice, close: lastPrice },
      ],
      trades: [],
      trades_truncated: false,
      latest_quote: {
        reference: ref,
        ceiling,
        floor,
        matchPrice: lastPrice,
        openPrice: Number(item.openPrice || ref),
        highPrice: Number(item.highPrice || lastPrice),
        lowPrice: Number(item.lowPrice || lastPrice),
        totalVolume,
        bids,
        asks,
      },
      foreign_flow: {
        totalBuyVolume: Number(item.fBVol || 0) * 10,
        totalSellVolume: Number(item.fSVolume || 0) * 10,
        totalBuyValue: Number(item.fBValue || 0) * 1000,
        totalSellValue: Number(item.fSValue || 0) * 1000,
        foreignNetVolume: (Number(item.fBVol || 0) - Number(item.fSVolume || 0)) * 10,
        foreignNetValue: (Number(item.fBValue || 0) - Number(item.fSValue || 0)) * 1000,
        foreignRoom: Number(item.fRoom || 0) * 10,
      },
      put_through: [],
      updated_at: new Date().toISOString(),
    })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Snapshot storage is not configured." }, { status: 503 })
  }

  const { error } = await supabase
    .from("stock_orderbook_snapshots")
    .upsert(records, { onConflict: "symbol" })

  if (error) {
    console.error("[Market Sync] Supabase upsert failed", error)
    return NextResponse.json({ ok: false, message: "Snapshot persistence failed." }, { status: 503 })
  }

  return NextResponse.json({
    ok: true,
    source: "vps_authoritative_market_feed",
    count: records.length,
    persistedToSupabase: true,
    persistedCount: records.length,
    durationMs: Date.now() - startedAt,
  })
}
