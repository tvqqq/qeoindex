import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upstash-signature, upstash-message-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const CANONICAL_UNIVERSE_TICKERS = [
  "VIC", "VHM", "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "HPG", "GAS",
  "MCH", "LPB", "VPL", "STB", "HDB", "BSR", "ACB", "VNM", "FPT", "GVR",
  "DMX", "TCX", "MWG", "MSN", "VJC", "HVN", "VCK", "SHB", "SSI", "SAB",
  "VRE", "SSB", "MSB", "VIB", "BVH", "VPX", "PLX", "GEE", "POW", "TPB",
  "BCM", "HCM", "EIB", "NVL", "VIX", "GMD", "GEX", "OCB", "REE", "GEL",
  "PGV", "KBC", "VCI", "VND", "NAB", "FRT", "KDH", "VPI", "SBT", "PNJ",
  "HAG", "VGC", "PVD", "DCM", "DGC", "CRV", "DPM", "KDC", "VBB", "SJS",
  "DXG", "LGC", "TAL", "DHG", "SIP", "BMP", "PDR", "BAF", "NLG", "VCG",
  "VHC", "TCH", "VSH", "CTR", "KLB", "BWE", "DSE", "CII", "EVF", "PVT",
  "VTP", "HPA", "ORS", "DGW", "HAH", "HSG", "PC1", "DIG", "FTS", "PHR"
]

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? ""

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ ok: false, message: "Supabase environment not configured." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    let rawSnapshots: any[] = []
    let isEodAutomated = false

    if (req.method === "POST") {
      try {
        const body = await req.json()
        if (Array.isArray(body?.snapshots)) {
          rawSnapshots = body.snapshots
        } else if (body?.symbol) {
          rawSnapshots = [body]
        } else {
          isEodAutomated = true
        }
      } catch {
        isEodAutomated = true
      }
    } else {
      isEodAutomated = true
    }

    if (isEodAutomated || rawSnapshots.length === 0) {
      // 1. Fetch Put-Through deals
      const ptMap: Record<string, any[]> = {}
      try {
        const ptRes = await fetch("https://bgapidatafeed.vps.com.vn/getlistpt", {
          headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
          signal: AbortSignal.timeout(5000),
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
      } catch {
        // continue without PT deals if failed
      }

      // 2. Fetch Board quotes and Foreign Flow
      const quotesUrl = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`
      const quotesRes = await fetch(quotesUrl, {
        headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
        signal: AbortSignal.timeout(8000),
      })
      const quotesList = await quotesRes.json()
      const quoteMap: Record<string, any> = {}
      if (Array.isArray(quotesList)) {
        for (const q of quotesList) {
          if (q.sym) quoteMap[String(q.sym).toUpperCase()] = q
        }
      }

      // 3. Fetch granular trades for tickers
      const tradesMap: Record<string, any[]> = {}
      const CONCURRENCY = 15
      for (let i = 0; i < CANONICAL_UNIVERSE_TICKERS.length; i += CONCURRENCY) {
        const chunk = CANONICAL_UNIVERSE_TICKERS.slice(i, i + CONCURRENCY)
        await Promise.all(
          chunk.map(async (ticker) => {
            try {
              const res = await fetch(`https://bgapidatafeed.vps.com.vn/getliststocktrade/${ticker}`, {
                headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
                signal: AbortSignal.timeout(4000),
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
      }

      // 4. Build records
      const records: any[] = []
      for (const ticker of CANONICAL_UNIVERSE_TICKERS) {
        const q = quoteMap[ticker] || {}
        const trades = tradesMap[ticker] || []
        const putThrough = ptMap[ticker] || []

        const rawRef = Number(q.r || q.closePrice ? Number(q.r || q.closePrice) : (trades[0]?.price || 0))
        const ref = normalizePrice(rawRef)
        const rawLast = Number(q.lastPrice ?? (trades.length > 0 ? trades[trades.length - 1].price : ref))
        const lastPrice = normalizePrice(rawLast)
        const rawCeil = Number(q.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
        const ceiling = normalizePrice(rawCeil)
        const rawFloor = Number(q.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
        const floor = normalizePrice(rawFloor)
        const totalVolume = Number(q.lot || 0) * 10

        const bids = [parseGroupLevel(q.g1), parseGroupLevel(q.g2), parseGroupLevel(q.g3)].filter(Boolean)
        const asks = [parseGroupLevel(q.g4), parseGroupLevel(q.g5), parseGroupLevel(q.g6)].filter(Boolean)

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

        const buyVal = Number(q.fBValue || 0)
        const sellVal = Number(q.fSValue || 0)
        const buyVol = Number(q.fBVol || 0)
        const sellVol = Number(q.fSVolume || 0)

        records.push({
          symbol: ticker,
          session_date: today,
          reference_price: ref,
          ceiling_price: ceiling,
          floor_price: floor,
          latest_price: lastPrice,
          total_volume: totalVolume,
          intraday_1m: intraday1m.slice(-90),
          trades: trades.slice(-500),
          trades_truncated: trades.length > 500,
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

      if (records.length > 0) {
        const BATCH_SIZE = 25
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const chunk = records.slice(i, i + BATCH_SIZE)
          await supabase.from("stock_orderbook_snapshots").upsert(chunk, { onConflict: "symbol" })
        }

        return new Response(
          JSON.stringify({
            ok: true,
            source: "vps_full_deep_sync",
            count: records.length,
            session_date: today,
            synced_at: new Date().toISOString(),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    // Manual body fallback
    const records = rawSnapshots.map((item: any) => ({
      symbol: String(item.symbol || "").toUpperCase(),
      session_date: item.session_date ?? today,
      reference_price: normalizePrice(item.reference_price ?? item.latestQuote?.reference),
      ceiling_price: normalizePrice(item.ceiling_price ?? item.latestQuote?.ceiling),
      floor_price: normalizePrice(item.floor_price ?? item.latestQuote?.floor),
      latest_price: normalizePrice(item.latest_price ?? item.latestQuote?.matchPrice),
      total_volume: item.total_volume ?? item.latestQuote?.totalVolume ?? 0,
      intraday_1m: item.intraday_1m ?? item.prices ?? [],
      trades: item.trades ?? [],
      trades_truncated: Boolean(item.trades_truncated ?? item.tradesTruncated),
      latest_quote: item.latest_quote ?? item.latestQuote ?? {},
      foreign_flow: item.foreign_flow ?? item.foreign ?? {},
      put_through: item.put_through ?? item.putThrough ?? [],
      updated_at: new Date().toISOString(),
    })).filter((r: any) => /^[A-Z0-9]{2,12}$/.test(r.symbol))

    const { data, error } = await supabase
      .from("stock_orderbook_snapshots")
      .upsert(records, { onConflict: "symbol" })
      .select("symbol, updated_at")

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, message: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        count: records.length,
        synced: data?.map((d: any) => d.symbol) ?? records.map((r: any) => r.symbol),
        updated_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ ok: false, message: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
