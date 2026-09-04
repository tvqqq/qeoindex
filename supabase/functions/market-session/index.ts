import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { isMachineRequestAuthorized } from "../_shared/machine-auth.ts"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../_shared/vn-market-calendar.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  }

  const authorized = await isMachineRequestAuthorized(req, [
    Deno.env.get("MARKET_SYNC_SECRET"),
    Deno.env.get("CRON_SECRET"),
  ])
  if (!authorized) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const url = new URL(req.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()

  if (!symbol || !/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return jsonResponse({ ok: false, message: "Missing or invalid stock symbol." }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? ""

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ ok: false, message: "Supabase environment not configured." }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  if (req.method === "POST") {
    try {
      const body = await req.json()
      if (!body || !body.symbol) {
        return jsonResponse({ ok: false, message: "Invalid orderbook snapshot payload." }, 400)
      }

      const sessionDate = String(body.session_date ?? vietnamDateKey(new Date()))
      if (!isVietnamSecuritiesTradingDateKey(sessionDate)) {
        return jsonResponse({ ok: true, skipped: true, reason: "NON_TRADING_DAY", session_date: sessionDate })
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
        return jsonResponse({ ok: false, message: error.message }, 500)
      }

      return jsonResponse({
        ok: true,
        skipped: false,
        symbol: payload.symbol,
        session_date: sessionDate,
        updated_at: payload.updated_at,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return jsonResponse({ ok: false, message: msg }, 500)
    }
  }

  const { data, error } = await supabase
    .from("stock_orderbook_snapshots")
    .select("*")
    .eq("symbol", symbol)
    .single()

  if (error || !data) {
    return jsonResponse({ ok: false, symbol, message: "No snapshot found for symbol." }, 404)
  }

  const sessionStart = data.intraday_1m?.[0]?.time ?? Math.floor(Date.now() / 1000)

  return jsonResponse({
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
  })
})
