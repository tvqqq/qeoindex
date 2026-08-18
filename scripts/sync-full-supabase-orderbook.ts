import { createClient } from "@supabase/supabase-js"
import { CANONICAL_UNIVERSE_TICKERS } from "../lib/wyckoff-universe.ts"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glwhhrmejlonhyorvtzm.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function normalizePrice(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const normalized = price >= 500 ? price / 1000 : price
  return Math.round(normalized * 100) / 100
}

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const parts = raw.split("|")
  const rawP = Number(parts[0] ?? 0)
  const price = normalizePrice(rawP) ?? 0
  const volume = Number(parts[1] ?? 0)
  return price > 0 ? { price, volume } : null
}

function formatTimeString(t: any): string {
  const raw = String(t.timeServer || t.time || "").trim()
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`
  const num = Number(raw)
  if (Number.isFinite(num) && num >= 0 && num < 86400) {
    const hrs = Math.floor(num / 3600) % 24
    const mins = Math.floor((num % 3600) / 60)
    const secs = Math.floor(num % 60)
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }
  return "09:15:00"
}

function parseTradeSide(t: any): "BUY" | "SELL" | "REF" {
  const rawSide = String(t.side || "").trim().toUpperCase()
  if (rawSide === "B" || rawSide === "BUY" || rawSide === "MUA") return "BUY"
  if (rawSide === "S" || rawSide === "SELL" || rawSide === "BAN" || rawSide === "BÁN") return "SELL"
  const cl = String(t.cl || "").trim().toLowerCase()
  if (cl === "i" || cl === "u") return "BUY"
  if (cl === "d") return "SELL"
  return "REF"
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
          const rawP = Number(item.price || 0)
          const p = normalizePrice(rawP) ?? 0
          ptMap[sym].push({
            id: String(item.transId || item.id || `pt-${ptMap[sym].length}`),
            time: String(item.time || "—"),
            price: p,
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
                const side = parseTradeSide(t)
                const price = normalizePrice(Number(t.lastPrice || t.price || 0)) ?? 0
                return {
                  id: String(t.transId || t.sID || `${ticker}-${idx}`),
                  time: formatTimeString(t),
                  price,
                  volume: Number(t.lastVol || t.volume || t.totalVol || 0),
                  side,
                }
              }).filter((t: any) => t.price > 0)
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

    const rawRef = Number(q.r ?? q.closePrice ?? (trades.length > 0 ? trades[0].price : 0))
    const ref = normalizePrice(rawRef)
    const rawLast = Number(q.lastPrice ?? q.openPrice ?? (trades.length > 0 ? trades[trades.length - 1].price : (ref ?? 0)))
    const lastPrice = normalizePrice(rawLast) || ref
    const rawCeil = Number(q.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
    const ceiling = normalizePrice(rawCeil) || (ref ? Math.round(ref * 1.07 * 100) / 100 : null)
    const rawFloor = Number(q.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
    const floor = normalizePrice(rawFloor) || (ref ? Math.round(ref * 0.93 * 100) / 100 : null)
    const totalVolume = Number(q.lot || 0) * 10

    const bids = [parseGroupLevel(q.g1), parseGroupLevel(q.g2), parseGroupLevel(q.g3)].filter(Boolean)
    const asks = [parseGroupLevel(q.g4), parseGroupLevel(q.g5), parseGroupLevel(q.g6)].filter(Boolean)

    // Build 1m intraday bars from trades
    const intraday1m: any[] = []
    if (trades.length > 0) {
      for (const t of trades) {
        intraday1m.push({
          time: t.time,
          open: t.price,
          close: t.price,
        })
      }
    } else {
      intraday1m.push(
        { time: "09:15:00", open: ref, close: lastPrice },
        { time: "14:45:00", open: lastPrice, close: lastPrice }
      )
    }

    let buyVal = Number(q.fBValue || 0)
    let sellVal = Number(q.fSValue || 0)
    const buyVol = Number(q.fBVol || 0)
    const sellVol = Number(q.fSVolume || 0)
    if (buyVol > 0 && buyVal > 0 && buyVal < buyVol * 1000) buyVal = buyVal * 100
    if (sellVol > 0 && sellVal > 0 && sellVal < sellVol * 1000) sellVal = sellVal * 100
    if (buyVal <= 0 && buyVol > 0 && lastPrice) buyVal = buyVol * lastPrice * 1000
    if (sellVal <= 0 && sellVol > 0 && lastPrice) sellVal = sellVol * lastPrice * 1000

    records.push({
      symbol: ticker,
      session_date: today,
      reference_price: ref,
      ceiling_price: ceiling,
      floor_price: floor,
      latest_price: lastPrice,
      total_volume: totalVolume,
      intraday_1m: intraday1m.slice(-90),
      trades: trades.slice(-3000), // Keep up to 3000 granular session trades (covers full 09:15 to 14:45)
      trades_truncated: trades.length > 3000,
      latest_quote: {
        reference: ref,
        ceiling,
        floor,
        matchPrice: lastPrice,
        openPrice: normalizePrice(Number(q.openPrice || ref)),
        highPrice: normalizePrice(Number(q.highPrice || lastPrice)),
        lowPrice: normalizePrice(Number(q.lowPrice || lastPrice)),
        totalVolume,
        bids,
        asks,
      },
      foreign_flow: {
        totalBuyVolume: buyVol,
        totalSellVolume: sellVol,
        totalBuyValue: Math.round(buyVal),
        totalSellValue: Math.round(sellVal),
        foreignNetVolume: buyVol - sellVol,
        foreignNetValue: Math.round(buyVal - sellVal),
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
