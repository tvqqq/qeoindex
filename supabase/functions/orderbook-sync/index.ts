import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, message: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

  try {
    const body = await req.json()
    const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : (body?.symbol ? [body] : [])

    if (snapshots.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: "No snapshot items provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    const records = snapshots.map((item: any) => ({
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
