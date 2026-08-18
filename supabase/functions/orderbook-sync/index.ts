import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upstash-signature, upstash-message-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const CANONICAL_UNIVERSE_TICKERS = [
  "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "LPB", "STB", "HDB", "ACB",
  "SHB", "SSB", "MSB", "VIB", "TPB", "EIB", "OCB", "NAB", "KLB", "VBB",
  "VAB", "BVB", "EVF",
  "TCX", "VCK", "VPX", "SSI", "HCM", "VIX", "VCI", "VND", "DSE", "ORS", "FTS",
  "VIC", "VHM", "VRE", "BCM", "NVL", "KBC", "KDH", "VPI", "CRV", "SJS",
  "DXG", "TAL", "SIP", "PDR", "NLG", "TCH", "DIG",
  "MCH", "VNM", "MWG", "MSN", "SAB", "FRT", "SBT", "PNJ", "KDC", "DHG",
  "BAF", "VHC", "HPA", "DGW",
  "GAS", "BSR", "PLX", "PVD", "POW", "REE", "PGV", "VSH", "BWE",
  "HPG", "GVR", "GEE", "GEX", "GEL", "HAG", "VGC", "DCM", "DGC", "DPM",
  "LGC", "BMP", "VCG", "CII", "HSG", "PC1",
  "VJC", "HVN", "VPL", "FPT", "BVH", "GMD", "CTR", "PVT", "VTP", "HAH"
]

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const parts = raw.split("|")
  const price = Number(parts[0] ?? 0)
  const volume = Number(parts[1] ?? 0)
  return price > 0 ? { price, volume } : null
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

    // Automated sync of all 100 universe stocks with authoritative market prices
    if (isEodAutomated || rawSnapshots.length === 0) {
      const records: any[] = []
      const url = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`
      
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) {
        throw new Error(`Market feed request failed with status ${res.status}`)
      }

      const feedData = await res.json()
      if (!Array.isArray(feedData) || feedData.length === 0) {
        throw new Error("Market feed returned empty list.")
      }

      for (const item of feedData) {
        const symbol = String(item.sym || "").toUpperCase()
        if (!symbol) continue

        const ref = Number(item.r || item.closePrice ? Number(item.r || item.closePrice) : 0)
        const lastPrice = Number(item.lastPrice ?? item.openPrice ?? ref)
        const ceiling = Number(item.c ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : 0))
        const floor = Number(item.f ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : 0))
        const totalVolume = Number(item.lot || 0) * 10 // lot is in 10s or exact shares

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
            totalBuyVolume: Number(item.fBVol || 0),
            totalSellVolume: Number(item.fSVolume || 0),
            totalBuyValue: Number(item.fBValue || 0),
            totalSellValue: Number(item.fSValue || 0),
            foreignNetValue: Number(item.fBValue || 0) - Number(item.fSValue || 0),
          },
          put_through: [],
          updated_at: new Date().toISOString(),
        })
      }

      if (records.length > 0) {
        const { error } = await supabase
          .from("stock_orderbook_snapshots")
          .upsert(records, { onConflict: "symbol" })

        if (error) {
          return new Response(
            JSON.stringify({ ok: false, message: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          )
        }

        return new Response(
          JSON.stringify({
            ok: true,
            source: "vps_authoritative_market_feed",
            count: records.length,
            session_date: today,
            synced_at: new Date().toISOString(),
            sample: records.slice(0, 5).map((r) => ({
              symbol: r.symbol,
              ref: r.reference_price,
              last: r.latest_price,
              ceiling: r.ceiling_price,
              floor: r.floor_price,
            })),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    // Manual / explicit body snapshots fallback
    const records = rawSnapshots.map((item: any) => ({
      symbol: String(item.symbol || "").toUpperCase(),
      session_date: item.session_date ?? today,
      reference_price: item.reference_price ?? item.latestQuote?.reference ?? null,
      ceiling_price: item.ceiling_price ?? item.latestQuote?.ceiling ?? null,
      floor_price: item.floor_price ?? item.latestQuote?.floor ?? null,
      latest_price: item.latest_price ?? item.latestQuote?.matchPrice ?? null,
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
