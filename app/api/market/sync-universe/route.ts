import { NextResponse } from "next/server"

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

export async function GET(request: Request) {
  return handleSync(request)
}

export async function POST(request: Request) {
  return handleSync(request)
}

async function handleSync(request: Request) {
  const startedAt = Date.now()
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  const url = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`

  let feedData: any[] = []
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      feedData = await res.json()
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: `Failed to fetch market data feed: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 502 })
  }

  if (!Array.isArray(feedData) || feedData.length === 0) {
    return NextResponse.json({
      ok: false,
      message: "Market data feed returned empty list",
    }, { status: 502 })
  }

  const records: any[] = []
  for (const item of feedData) {
    const symbol = String(item.sym || "").toUpperCase()
    if (!symbol) continue

    const ref = Number(item.r || item.closePrice ? Number(item.r || item.closePrice) : 0)
    const lastPrice = Number(item.lastPrice ?? item.openPrice ?? ref)
    const ceiling = Number(item.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
    const floor = Number(item.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
    const totalVolume = Number(item.lot || 0) * 10

    const bids = [parseGroupLevel(item.g1), parseGroupLevel(item.g2), parseGroupLevel(item.g3)].filter(Boolean)
    const asks = [parseGroupLevel(item.g4), parseGroupLevel(item.g5), parseGroupLevel(item.g6)].filter(Boolean)

    records.push({
      symbol,
      session_date: today,
      reference_price: ref > 0 ? ref : null,
      ceiling_price: ceiling > 0 ? ceiling : null,
      floor_price: floor > 0 ? floor : null,
      latest_price: lastPrice > 0 ? lastPrice : null,
      total_volume: totalVolume,
      intraday_1m: [
        {
          time: Math.floor(Date.now() / 1000) - 3600,
          open: Number(item.openPrice || ref),
          close: lastPrice,
        },
        {
          time: Math.floor(Date.now() / 1000),
          open: lastPrice,
          close: lastPrice,
        }
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
  let persisted = false
  let persistedCount = 0

  if (supabase && records.length > 0) {
    const { error } = await supabase
      .from("stock_orderbook_snapshots")
      .upsert(records, { onConflict: "symbol" })
    
    if (!error) {
      persisted = true
      persistedCount = records.length
    }
  }

  return NextResponse.json({
    ok: true,
    source: "vps_authoritative_market_feed",
    count: records.length,
    persistedToSupabase: persisted,
    persistedCount,
    durationMs: Date.now() - startedAt,
    sample: records.slice(0, 8).map((r) => ({
      symbol: r.symbol,
      ref: r.reference_price,
      last: r.latest_price,
      ceiling: r.ceiling_price,
      floor: r.floor_price,
      vol: r.total_volume,
    })),
  })
}
