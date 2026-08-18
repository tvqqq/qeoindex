import { createClient } from "@supabase/supabase-js"
import { CANONICAL_UNIVERSE_TICKERS } from "../lib/wyckoff-universe.ts"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glwhhrmejlonhyorvtzm.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const parts = raw.split("|")
  const price = Number(parts[0] ?? 0)
  const volume = Number(parts[1] ?? 0)
  return price > 0 ? { price, volume } : null
}

function parseSeconds(timeStr: string): number {
  const parts = timeStr.split(":").map(Number)
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
  if (parts.length === 2) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60
  return 0
}

async function syncAll() {
  const startedAt = Date.now()
  console.log(`Starting deep sync for all ${CANONICAL_UNIVERSE_TICKERS.length} tickers into Supabase...`)

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  // 1. Fetch Put-Through deals
  console.log("Fetching Put-Through deals from VPS...")
  const ptMap: Record<string, any[]> = {}
  try {
    const ptRes = await fetch("https://bgapidatafeed.vps.com.vn/getlistpt", {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(6000),
    })
    if (ptRes.ok) {
      const ptList = await ptRes.json()
      if (Array.isArray(ptList)) {
        for (const item of ptList) {
          const sym = String(item.sym || "").toUpperCase().trim()
          if (!sym) continue
          if (!ptMap[sym]) ptMap[sym] = []
          ptMap[sym].push({
            id: String(item.transId || item.id || `pt-${ptMap[sym].length}`),
            time: String(item.time || "—"),
            price: Number(item.price || 0),
            volume: Number(item.volume || 0),
            value: Number(item.value || 0),
            type: String(item.type || "PTM"),
          })
        }
      }
    }
  } catch (err) {
    console.warn("Put-through fetch warning:", err)
  }

  // 2. Fetch Board quotes and Foreign Flow for 100 tickers
  console.log("Fetching Board quotes and Foreign Flow...")
  const quotesUrl = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`
  const quotesRes = await fetch(quotesUrl, {
    headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
    signal: AbortSignal.timeout(10000),
  })
  const quotesList = await quotesRes.json()
  const quoteMap: Record<string, any> = {}
  if (Array.isArray(quotesList)) {
    for (const q of quotesList) {
      if (q.sym) quoteMap[String(q.sym).toUpperCase()] = q
    }
  }

  // 3. Fetch Session Trades for each ticker (in parallel batches of 15)
  console.log("Fetching Granular Session Trades...")
  const tradesMap: Record<string, any[]> = {}
  const CONCURRENCY = 15

  for (let i = 0; i < CANONICAL_UNIVERSE_TICKERS.length; i += CONCURRENCY) {
    const chunk = CANONICAL_UNIVERSE_TICKERS.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (ticker) => {
        try {
          const res = await fetch(`https://bgapidatafeed.vps.com.vn/getliststocktrade/${ticker}`, {
            headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
            signal: AbortSignal.timeout(5000),
          })
          if (res.ok) {
            const rawTrades = await res.json()
            if (Array.isArray(rawTrades) && rawTrades.length > 0) {
              tradesMap[ticker] = rawTrades.map((t: any, idx: number) => {
                const sideRaw = String(t.cl || t.side || "").toLowerCase()
                const side = sideRaw === "u" || sideRaw === "b" || sideRaw === "buy" ? "BUY"
                  : sideRaw === "d" || sideRaw === "s" || sideRaw === "sell" ? "SELL"
                  : "REF"
                return {
                  id: String(t.transId || t.sID || `${ticker}-${idx}`),
                  time: parseSeconds(String(t.time || t.timeServer || "09:15:00")),
                  price: Number(t.lastPrice || t.price || 0),
                  volume: Number(t.lastVol || t.volume || t.totalVol || 0),
                  side,
                }
              })
            }
          }
        } catch {
          tradesMap[ticker] = []
        }
      })
    )
    process.stdout.write(`.`)
  }
  console.log("\nFetched trades for all tickers.")

  // 4. Construct complete snapshot payloads
  const records: any[] = []
  for (const ticker of CANONICAL_UNIVERSE_TICKERS) {
    const q = quoteMap[ticker] || {}
    const trades = tradesMap[ticker] || []
    const putThrough = ptMap[ticker] || []

    const ref = Number(q.r || q.closePrice ? Number(q.r || q.closePrice) : (trades[0]?.price || 0))
    const lastPrice = Number(q.lastPrice ?? (trades.length > 0 ? trades[trades.length - 1].price : ref))
    const ceiling = Number(q.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
    const floor = Number(q.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
    const totalVolume = Number(q.lot || (trades.reduce((acc: number, t: any) => acc + (t.volume || 0), 0) / 10) || 0) * 10

    const bids = [parseGroupLevel(q.g1), parseGroupLevel(q.g2), parseGroupLevel(q.g3)].filter(Boolean)
    const asks = [parseGroupLevel(q.g4), parseGroupLevel(q.g5), parseGroupLevel(q.g6)].filter(Boolean)

    // Build 1m intraday bars from trades
    const intraday1m: any[] = []
    if (trades.length > 0) {
      // Group trades into 1m buckets (60s)
      const minuteMap = new Map<number, { open: number; close: number; time: number }>()
      for (const t of trades) {
        if (!t.time || !t.price) continue
        const bucket = Math.floor(t.time / 60) * 60
        if (!minuteMap.has(bucket)) {
          minuteMap.set(bucket, { time: bucket, open: t.price, close: t.price })
        } else {
          minuteMap.get(bucket)!.close = t.price
        }
      }
      for (const bar of minuteMap.values()) {
        intraday1m.push(bar)
      }
      intraday1m.sort((a, b) => a.time - b.time)
    } else {
      intraday1m.push(
        { time: 33300, open: Number(q.openPrice || ref), close: lastPrice },
        { time: 53100, open: lastPrice, close: lastPrice }
      )
    }

    const buyVal = Number(q.fBValue || 0)
    const sellVal = Number(q.fSValue || 0)
    const buyVol = Number(q.fBVol || 0)
    const sellVol = Number(q.fSVolume || 0)

    records.push({
      symbol: ticker,
      session_date: today,
      reference_price: ref > 0 ? ref : null,
      ceiling_price: ceiling > 0 ? ceiling : null,
      floor_price: floor > 0 ? floor : null,
      latest_price: lastPrice > 0 ? lastPrice : null,
      total_volume: totalVolume,
      intraday_1m: intraday1m,
      trades: trades.slice(-500), // Keep top 500 granular matched trades in snapshot
      trades_truncated: trades.length > 500,
      latest_quote: {
        reference: ref,
        ceiling,
        floor,
        matchPrice: lastPrice,
        openPrice: Number(q.openPrice || ref),
        highPrice: Number(q.highPrice || lastPrice),
        lowPrice: Number(q.lowPrice || lastPrice),
        totalVolume,
        bids,
        asks,
      },
      foreign_flow: {
        totalBuyVolume: buyVol,
        totalSellVolume: sellVol,
        totalBuyValue: buyVal,
        totalSellValue: sellVal,
        foreignNetVolume: buyVol - sellVol,
        foreignNetValue: buyVal - sellVal,
        foreignRoom: Number(q.fRoom || 0),
        updatedAt: new Date().toISOString(),
      },
      put_through: putThrough,
      updated_at: new Date().toISOString(),
    })
  }

  console.log(`Upserting ${records.length} full snapshots to Supabase...`)

  // Upsert in batches of 25
  const BATCH_SIZE = 25
  let upsertedCount = 0
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from("stock_orderbook_snapshots")
      .upsert(chunk, { onConflict: "symbol" })

    if (error) {
      console.error(`Error upserting batch ${i}:`, error.message)
    } else {
      upsertedCount += chunk.length
    }
  }

  console.log(`✅ Completed! Upserted ${upsertedCount}/${records.length} stocks with full trades, foreign flow, and put through in ${Date.now() - startedAt}ms.`)
}

syncAll().catch(console.error)
