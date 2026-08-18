import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upstash-signature, upstash-message-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const DEFAULT_UNIVERSE = [
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB",
  "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
  "DGC", "DXG", "DIG", "PDR", "KDH", "NLG", "KBC", "VCI", "HCM", "VIX",
  "VND", "MBS", "CTS", "BSI", "FTS", "PVD", "PVS", "PVT", "BSR", "DCM",
  "DPM", "GEX", "REE", "PC1", "HDG", "KDC", "SBT", "VHC", "ANV", "IDI",
  "HSG", "NKG", "VGS", "HAH", "GMD", "VOS", "DGW", "FRT", "PET", "CTR",
  "FOX", "ELC", "CMG", "SZC", "IDC", "ITA", "TCH", "HDC", "SCR", "CEO",
  "CII", "HHV", "VCG", "LCG", "FCN", "CTD", "HBC", "DBC", "BAF", "HAG",
  "PAN", "LTG", "TNG", "MSH", "STK", "NT2", "GEG", "QTP", "HND", "VPI"
]

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

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    // If no explicit snapshots provided, fetch active EOD universe data directly
    if (isEodAutomated || rawSnapshots.length === 0) {
      const records: any[] = []
      const CONCURRENCY = 15

      for (let i = 0; i < DEFAULT_UNIVERSE.length; i += CONCURRENCY) {
        const chunk = DEFAULT_UNIVERSE.slice(i, i + CONCURRENCY)
        await Promise.all(
          chunk.map(async (ticker) => {
            try {
              const period2 = Math.floor(Date.now() / 1000) + 300
              const period1 = period2 - 7 * 86400
              const res = await fetch(
                `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.VN?period1=${period1}&period2=${period2}&interval=5m&events=history&includeAdjustedClose=true`,
                { headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" }, signal: AbortSignal.timeout(3500) }
              )
              if (!res.ok) return
              const json = await res.json()
              const result = json.chart?.result?.[0]
              if (!result) return

              const timestamps = result.timestamp || []
              const closes = result.indicators?.quote?.[0]?.close || []
              const opens = result.indicators?.quote?.[0]?.open || []
              const points = []
              for (let j = 0; j < timestamps.length; j++) {
                if (closes[j] && closes[j] > 0) {
                  points.push({ time: timestamps[j], open: opens[j] || closes[j], close: closes[j] })
                }
              }

              const latestPrice = points.length > 0 ? points[points.length - 1].close : null
              const ref = result.meta?.chartPreviousClose || (points.length > 0 ? points[0].open : latestPrice)
              const totalVolume = result.meta?.regularMarketVolume || 0

              if (latestPrice && ref) {
                records.push({
                  symbol: ticker,
                  session_date: today,
                  reference_price: ref,
                  ceiling_price: Math.round(ref * 1.07),
                  floor_price: Math.round(ref * 0.93),
                  latest_price: latestPrice,
                  total_volume: totalVolume,
                  intraday_1m: points.slice(-90),
                  trades: [],
                  trades_truncated: false,
                  latest_quote: {
                    reference: ref,
                    matchPrice: latestPrice,
                    ceiling: Math.round(ref * 1.07),
                    floor: Math.round(ref * 0.93),
                    totalVolume,
                  },
                  foreign_flow: {},
                  put_through: [],
                  updated_at: new Date().toISOString(),
                })
              }
            } catch {
              // Ignore single ticker failure in edge worker
            }
          })
        )
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
            source: "qstash_eod_sync",
            count: records.length,
            session_date: today,
            synced_at: new Date().toISOString(),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

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

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: "No valid symbol records to upsert." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

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
