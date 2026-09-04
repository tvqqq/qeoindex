import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { isMachineRequestAuthorized } from "../_shared/machine-auth.ts"
import {
  isVietnamSecuritiesTradingDateKey,
  isVietnamSecuritiesTradingDay,
  vietnamDateKey,
} from "../_shared/vn-market-calendar.ts"

const UNIVERSE_KEY = "vn_top_stocks"
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-market-sync-secret, x-client-info, apikey, content-type, upstash-signature, upstash-message-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

async function isOrderbookSyncAuthorized(req: Request) {
  const secrets = [
    Deno.env.get("MARKET_SYNC_SECRET"),
    Deno.env.get("MARKET_SYNC_SECRET_PREVIOUS"),
    Deno.env.get("KFSP_SYNC_SECRET"),
    Deno.env.get("CRON_SECRET"),
  ]

  if (await isMachineRequestAuthorized(req, secrets)) return true

  // Transitional compatibility for callers that already use the dedicated
  // market-sync header. New server/cron callers should prefer Bearer auth.
  const customSecret = req.headers.get("x-market-sync-secret")?.trim() ?? ""
  if (!customSecret) return false

  return isMachineRequestAuthorized(new Request(req.url, {
    headers: { authorization: `Bearer ${customSecret}` },
  }), secrets)
}

function normalizePrice(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const normalized = price >= 500 ? price / 1000 : price
  return Math.round(normalized * 100) / 100
}

function parseGroupLevel(raw: string | undefined): { price: number; volume: number } | null {
  if (!raw || typeof raw !== "string") return null
  const [rawPrice, rawVolume] = raw.split("|")
  const price = normalizePrice(Number(rawPrice ?? 0)) ?? 0
  const volume = Number(rawVolume ?? 0)
  return price > 0 ? { price, volume } : null
}

function formatTimeString(t: Record<string, unknown>): string {
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

function parseTradeSide(t: Record<string, unknown>): "BUY" | "SELL" | "REF" {
  const rawSide = String(t.side || "").trim().toUpperCase()
  if (["B", "BUY", "MUA"].includes(rawSide)) return "BUY"
  if (["S", "SELL", "BAN", "BÁN"].includes(rawSide)) return "SELL"
  const cl = String(t.cl || "").trim().toLowerCase()
  if (cl === "i" || cl === "u") return "BUY"
  if (cl === "d") return "SELL"
  return "REF"
}

async function loadCanonicalTickers(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("qeo_current_market_universe", { p_universe_key: UNIVERSE_KEY })
  if (error) throw new Error(`Canonical universe unavailable: ${error.message}`)
  const stocks = Array.isArray(data?.stocks) ? data.stocks : []
  const tickers = stocks
    .map((stock: Record<string, unknown>) => String(stock.ticker || "").toUpperCase())
    .filter((ticker: string) => /^[A-Z0-9]{2,12}$/.test(ticker))
  if (!tickers.length || tickers.length > 200) throw new Error(`Canonical universe invalid: ${tickers.length} tickers`)
  return { tickers, runId: String(data?.runId || "") }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  }

  if (!(await isOrderbookSyncAuthorized(req))) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ ok: false, message: "Supabase environment not configured." }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const now = new Date()
    const today = vietnamDateKey(now)
    let rawSnapshots: Record<string, unknown>[] = []
    let isAutomated = false
    if (req.method === "POST") {
      try {
        const body = await req.json()
        if (Array.isArray(body?.snapshots)) rawSnapshots = body.snapshots
        else if (body?.symbol) rawSnapshots = [body]
        else isAutomated = true
      } catch { isAutomated = true }
    } else isAutomated = true

    if ((isAutomated || rawSnapshots.length === 0) && !isVietnamSecuritiesTradingDay(now)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "NON_TRADING_DAY",
        session_date: today,
        count: 0,
        synced_at: now.toISOString(),
      })
    }

    const { tickers, runId } = await loadCanonicalTickers(supabase)
    const tickerSet = new Set(tickers)

    if (isAutomated || rawSnapshots.length === 0) {
      const ptMap: Record<string, Record<string, unknown>[]> = {}
      try {
        const ptRes = await fetch("https://bgapidatafeed.vps.com.vn/getlistpt", {
          headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" }, signal: AbortSignal.timeout(5000),
        })
        if (ptRes.ok) {
          const ptList = await ptRes.json()
          if (Array.isArray(ptList)) for (const raw of ptList) {
            const item = raw as Record<string, unknown>
            const sym = String(item.sym || "").toUpperCase().trim()
            if (!tickerSet.has(sym)) continue
            if (!ptMap[sym]) ptMap[sym] = []
            const p = normalizePrice(Number(item.price || 0)) ?? 0
            ptMap[sym].push({
              id: String(item.transId || item.id || `pt-${ptMap[sym].length}`), time: String(item.time || "—"),
              price: p, volume: Number(item.volume || 0),
              value: Number(item.value ? Number(item.value) * 1000 : p * 1000 * Number(item.volume || 0)), type: String(item.type || "PTM"),
            })
          }
        }
      } catch { /* optional provider */ }

      const quotesRes = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${tickers.join(",")}`, {
        headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" }, signal: AbortSignal.timeout(8000),
      })
      if (!quotesRes.ok) throw new Error(`VPS quote sync failed (${quotesRes.status})`)
      const quotesList = await quotesRes.json()
      const quoteMap: Record<string, Record<string, unknown>> = {}
      if (Array.isArray(quotesList)) for (const raw of quotesList) {
        const q = raw as Record<string, unknown>
        const sym = String(q.sym || "").toUpperCase()
        if (tickerSet.has(sym)) quoteMap[sym] = q
      }

      const tradesMap: Record<string, Record<string, unknown>[]> = {}
      const CONCURRENCY = 15
      for (let i = 0; i < tickers.length; i += CONCURRENCY) {
        const chunk = tickers.slice(i, i + CONCURRENCY)
        await Promise.all(chunk.map(async (ticker) => {
          try {
            const res = await fetch(`https://bgapidatafeed.vps.com.vn/getliststocktrade/${ticker}`, {
              headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" }, signal: AbortSignal.timeout(4000),
            })
            if (!res.ok) return
            const rawTrades = await res.json()
            if (!Array.isArray(rawTrades)) return
            tradesMap[ticker] = rawTrades.map((raw, idx) => {
              const t = raw as Record<string, unknown>
              const price = normalizePrice(Number(t.lastPrice || t.price || 0)) ?? 0
              return {
                id: String(t.transId || t.sID || `${ticker}-${idx}`), time: formatTimeString(t), price,
                volume: Number(t.lastVol || t.volume || t.totalVol || 0), side: parseTradeSide(t),
              }
            }).filter((trade) => Number(trade.price) > 0)
          } catch { tradesMap[ticker] = [] }
        }))
      }

      const records: Record<string, unknown>[] = []
      for (const ticker of tickers) {
        const q = quoteMap[ticker] || {}
        const trades = tradesMap[ticker] || []
        const putThrough = ptMap[ticker] || []
        const ref = normalizePrice(Number(q.r ?? q.closePrice ?? (trades.length ? trades[0].price : 0)))
        const lastPrice = normalizePrice(Number(q.lastPrice ?? q.openPrice ?? (trades.length ? trades[trades.length - 1].price : (ref ?? 0)))) || ref
        const ceiling = normalizePrice(Number(q.c ?? 0)) || (ref ? Math.round(ref * 1.07 * 100) / 100 : null)
        const floor = normalizePrice(Number(q.f ?? 0)) || (ref ? Math.round(ref * 0.93 * 100) / 100 : null)
        const totalVolume = Number(q.lot || 0) * 10
        const bids = [parseGroupLevel(q.g1 as string | undefined), parseGroupLevel(q.g2 as string | undefined), parseGroupLevel(q.g3 as string | undefined)].filter(Boolean)
        const asks = [parseGroupLevel(q.g4 as string | undefined), parseGroupLevel(q.g5 as string | undefined), parseGroupLevel(q.g6 as string | undefined)].filter(Boolean)
        const intraday1m = trades.length
          ? trades.map((t) => ({ time: t.time, open: t.price, close: t.price }))
          : [{ time: "09:15:00", open: ref, close: lastPrice }, { time: "14:45:00", open: lastPrice, close: lastPrice }]
        const buyVal = Number(q.fBValue || 0) * 1000, sellVal = Number(q.fSValue || 0) * 1000
        const buyVol = Number(q.fBVol || 0) * 10, sellVol = Number(q.fSVolume || 0) * 10

        records.push({
          symbol: ticker, session_date: today, reference_price: ref, ceiling_price: ceiling, floor_price: floor,
          latest_price: lastPrice, total_volume: totalVolume, intraday_1m: intraday1m.slice(-90),
          trades: trades.slice(-3000), trades_truncated: trades.length > 3000,
          latest_quote: {
            reference: ref, ceiling, floor, matchPrice: lastPrice, openPrice: normalizePrice(Number(q.openPrice || ref)),
            highPrice: normalizePrice(Number(q.highPrice || lastPrice)), lowPrice: normalizePrice(Number(q.lowPrice || lastPrice)), totalVolume, bids, asks,
          },
          foreign_flow: {
            totalBuyVolume: buyVol, totalSellVolume: sellVol, totalBuyValue: buyVal, totalSellValue: sellVal,
            foreignNetVolume: buyVol - sellVol, foreignNetValue: buyVal - sellVal, foreignRoom: Number(q.fRoom || 0) * 10,
            updatedAt: new Date().toISOString(),
          },
          put_through: putThrough, updated_at: new Date().toISOString(),
        })
      }

      for (let i = 0; i < records.length; i += 25) {
        const { error } = await supabase.from("stock_orderbook_snapshots").upsert(records.slice(i, i + 25), { onConflict: "symbol" })
        if (error) throw new Error(`Orderbook persistence failed: ${error.message}`)
      }

      return jsonResponse({
        ok: true, skipped: false, source: "vps_full_deep_sync", universeRunId: runId, universeCount: tickers.length,
        count: records.length, session_date: today, synced_at: new Date().toISOString(),
      })
    }

    const records = rawSnapshots.map((item) => {
      const latestQuote = (item.latestQuote || {}) as Record<string, unknown>
      const sessionDate = String(item.session_date ?? today)
      return {
        symbol: String(item.symbol || "").toUpperCase(), session_date: sessionDate,
        reference_price: normalizePrice(Number(item.reference_price ?? latestQuote.reference)),
        ceiling_price: normalizePrice(Number(item.ceiling_price ?? latestQuote.ceiling)),
        floor_price: normalizePrice(Number(item.floor_price ?? latestQuote.floor)),
        latest_price: normalizePrice(Number(item.latest_price ?? latestQuote.matchPrice)),
        total_volume: item.total_volume ?? latestQuote.totalVolume ?? 0,
        intraday_1m: item.intraday_1m ?? item.prices ?? [], trades: item.trades ?? [],
        trades_truncated: Boolean(item.trades_truncated ?? item.tradesTruncated), latest_quote: item.latest_quote ?? item.latestQuote ?? {},
        foreign_flow: item.foreign_flow ?? item.foreign ?? {}, put_through: item.put_through ?? item.putThrough ?? [], updated_at: new Date().toISOString(),
      }
    }).filter((record) => tickerSet.has(record.symbol) && isVietnamSecuritiesTradingDateKey(record.session_date))

    if (!records.length) {
      return jsonResponse({ ok: false, message: "No canonical trading-session snapshots supplied" }, 400)
    }

    const { data, error } = await supabase.from("stock_orderbook_snapshots").upsert(records, { onConflict: "symbol" }).select("symbol, updated_at")
    if (error) throw new Error(error.message)
    return jsonResponse({
      ok: true, skipped: false, universeRunId: runId, count: records.length,
      synced: data?.map((d: Record<string, unknown>) => d.symbol) ?? records.map((record) => record.symbol), updated_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonResponse({ ok: false, message: msg }, 500)
  }
})
