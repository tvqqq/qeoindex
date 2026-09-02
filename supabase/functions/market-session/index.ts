import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { isMachineRequestAuthorized } from "../_shared/machine-auth.ts"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../_shared/vn-market-calendar.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method === "POST") {
    const authorized = await isMachineRequestAuthorized(req, [
      Deno.env.get("MARKET_SYNC_SECRET"),
      Deno.env.get("CRON_SECRET"),
    ])
    if (!authorized) {
      return new Response(
        JSON.stringify({ ok: false, message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  const url = new URL(req.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()

  if (!symbol || !/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return new Response(
      JSON.stringify({ ok: false, message: "Missing or invalid stock symbol." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
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

  if (req.method === "POST") {
    try {
      const body = await req.json()
      if (!body || !body.symbol) {
        return new Response(
          JSON.stringify({ ok: false, message: "Invalid orderbook snapshot payload." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const sessionDate = String(body.session_date ?? vietnamDateKey(new Date()))
      if (!isVietnamSecuritiesTradingDateKey(sessionDate)) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "NON_TRADING_DAY", session_date: sessionDate }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const payload = {
        symbol: body.symbol.toUpperCase(),
        session_date: sessionDate,
        reference_price: body.reference_price ?? body.latestQuote?.reference ?? null,
        ceiling_price: body.ceiling_price ?? body.latestQuote?.ceiling ?? null,
        floor_price: body.floor_price ?? body.latestQuote?.floor ?? null,
        latest_price: body.latest_price ?? body.latestQuote?.matchPrice ?? null,
        total_volume: body.total_volume ?? body.latestQuote?.totalVolume ?? 0,
        intraday_1m: body.intraday_1m ?? body.prices ?? [],
        trades: body.trades ?? [],
        trades_truncated: Boolean(body.trades_truncated ?? body.tradesTruncated),
        latest_quote: body.latest_quote ?? body.latestQuote ?? {},
        foreign_flow: body.foreign_flow ?? body.foreign ?? {},
        put_through: body.put_through ?? body.putThrough ?? [],
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from("stock_orderbook_snapshots")
        .upsert(payload, { onConflict: "symbol" })

      if (error) {
        return new Response(
          JSON.stringify({ ok: false, message: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      return new Response(
        JSON.stringify({ ok: true, skipped: false, symbol: payload.symbol, session_date: sessionDate, updated_at: payload.updated_at }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(
        JSON.stringify({ ok: false, message: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  const { data, error } = await supabase
    .from("stock_orderbook_snapshots")
    .select("*")
    .eq("symbol", symbol)
    .single()

  if (error || !data) {
    return new Response(
      JSON.stringify({ ok: false, symbol, message: "No snapshot found for symbol." }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const sessionStart = data.intraday_1m?.[0]?.time ?? Math.floor(Date.now() / 1000)

  return new Response(
    JSON.stringify({
      ok: true,
      provider: "Supabase-Snapshot",
      storage: "Supabase Postgres",
      symbol: data.symbol,
      sessionDate: data.session_date,
      sessionStart,
      generatedAt: data.updated_at,
      prices: data.intraday_1m ?? [],
      trades: data.trades ?? [],
      tradesTruncated: Boolean(data.trades_truncated),
      latestQuote: data.latest_quote ?? null,
      foreign: data.foreign_flow ?? null,
      putThrough: data.put_through ?? [],
      completeness: {
        price: "full-session-1m",
        orderbook: "current-snapshot-plus-live",
        trades: data.trades_truncated ? "session-backfill-truncated" : "full-session-backfill",
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})
