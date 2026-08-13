import {
  evaluateBuy,
  evaluateExit,
  marketSessionProgress,
  SIGNAL_ENGINE_VERSION,
  type LiveQuote,
  type OpenRecommendationState,
  type SignalDailyScan,
} from "../../../lib/signal-engine.ts"

const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store" }
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function authorized(request: Request) {
  const secret = Deno.env.get("SIGNAL_MONITOR_SECRET") ?? ""
  return secret.length >= 24 && request.headers.get("authorization") === `Bearer ${secret}`
}

async function db(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service environment is unavailable")
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=representation", ...init.headers },
  })
  const text = await result.text()
  if (!result.ok) throw new Error(`Database request failed (${result.status}): ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : null
}

function scanNumber(value: unknown) {
  const number = Number(value)
  return value == null || !Number.isFinite(number) ? null : number
}

function parseScan(row: Record<string, unknown>): SignalDailyScan | null {
  const ticker = String(row.ticker ?? "").trim().toUpperCase()
  if (!ticker) return null
  return {
    ticker,
    date: String(row.scan_date ?? ""), price: scanNumber(row.price), volume: scanNumber(row.volume),
    ma20: scanNumber(row.ma20), ma50: scanNumber(row.ma50), atr14: scanNumber(row.atr14), relVolume: scanNumber(row.rel_volume),
    taBias: String(row.ta_bias ?? "Neutral"), bullProbability: scanNumber(row.bull_probability), baseProbability: scanNumber(row.base_probability), bearProbability: scanNumber(row.bear_probability),
    support: String(row.support ?? ""), resistance: String(row.resistance ?? ""), status: String(row.status ?? ""), confidence: String(row.confidence ?? ""),
  }
}

async function latestScans() {
  const rows = await db("daily_scans?order=scan_date.desc,created_at.desc&select=ticker,scan_date,price,volume,ma20,ma50,atr14,rel_volume,ta_bias,bull_probability,base_probability,bear_probability,support,resistance,status,confidence")
  const scans = new Map<string, SignalDailyScan>()
  for (const row of rows ?? []) {
    const scan = parseScan(row)
    if (scan && !scans.has(scan.ticker)) scans.set(scan.ticker, scan)
  }
  return scans
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function snapshot(symbols: string[], timeoutMs = 5500) {
  const apiKey = Deno.env.get("DNSE_API_KEY") ?? ""
  const secret = Deno.env.get("DNSE_API_SECRET") ?? ""
  if (!apiKey || !secret) throw new Error("DNSE credentials are not configured")
  const requested = [...new Set(symbols)]
  const quotes: Record<string, LiveQuote> = {}
  let vnindex: number | null = null
  const ws = new WebSocket(Deno.env.get("DNSE_WS_URL") ?? "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json")
  return await new Promise<{ quotes: Record<string, LiveQuote>; vnindex: number | null; detail: string }>((resolve, reject) => {
    let settled = false
    const finish = (detail: string) => { if (settled) return; settled = true; clearTimeout(timer); ws.close(); resolve({ quotes, vnindex, detail }) }
    const timer = setTimeout(() => finish(`timeout; ${Object.keys(quotes).length}/${requested.length} quotes`), timeoutMs)
    ws.onmessage = async ({ data }) => {
      try {
        const item = JSON.parse(String(data))
        if (item.action === "welcome") {
          const timestamp = Math.floor(Date.now() / 1000); const nonce = String(Date.now() * 1000)
          ws.send(JSON.stringify({ action: "auth", api_key: apiKey, signature: await hmacHex(secret, `${apiKey}:${timestamp}:${nonce}`), timestamp, nonce })); return
        }
        if (item.action === "auth_success") { ws.send(JSON.stringify({ action: "subscribe", channels: [{ name: "tick.G1.json", symbols: requested }, { name: "market_index.VNINDEX.json" }] })); return }
        if (item.action === "ping") { ws.send(JSON.stringify({ action: "pong", timestamp: item.timestamp })); return }
        if (item.action === "error") throw new Error(item.message ?? "DNSE stream error")
        if (item.T === "t" && item.symbol && Number(item.matchPrice) > 0) quotes[String(item.symbol).toUpperCase()] = { ticker: String(item.symbol).toUpperCase(), price: Number(item.matchPrice), totalVolume: Math.max(0, Number(item.totalVolumeTraded) || 0), timestamp: Date.now() }
        if (item.T === "mi" && String(item.indexName).toUpperCase() === "VNINDEX" && Number(item.valueIndexes) > 0) vnindex = Number(item.valueIndexes)
        if (Object.keys(quotes).length === requested.length && vnindex != null) finish("complete")
      } catch (error) { settled = true; clearTimeout(timer); ws.close(); reject(error) }
    }
    ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("DNSE WebSocket failed")) } }
    ws.onclose = () => finish("stream closed")
  })
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "Method not allowed" }, 405)
  if (!authorized(request)) return response({ ok: false, error: "Unauthorized" }, 401)
  const now = Date.now(); const session = marketSessionProgress(now)
  const runKey = `signal-monitor:${new Date(now).toISOString().slice(0, 16)}`
  let runId: string | undefined
  try {
    const initialStatus = session.active ? "running" : "skipped"
    const created = await db("monitor_runs?on_conflict=run_key", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ run_key: runKey, scheduled_for: new Date(now).toISOString(), session_state: session.label, status: initialStatus, finished_at: session.active ? null : new Date(now).toISOString(), function_version: SIGNAL_ENGINE_VERSION }),
    })
    if (!created?.length) return response({ ok: true, skipped: true, reason: "Monitor minute already claimed", session })
    runId = created?.[0]?.id
    if (!session.active) return response({ ok: true, skipped: true, reason: "Outside HOSE monitoring window", session })
    const [scans, rows] = await Promise.all([latestScans(), db("trade_recommendations?status=eq.open&select=*")])
    const open = (rows ?? []) as Array<Record<string, unknown>>
    const bullish = [...scans.values()].filter((scan) => scan.taBias === "Bullish" && scan.status === "Complete")
    const symbols = [...new Set([...bullish.map((scan) => scan.ticker), ...open.map((row) => String(row.ticker))])]
    const live = symbols.length ? await snapshot(symbols) : { quotes: {}, vnindex: null, detail: "no symbols" }
    let buyCount = 0; let exitCount = 0
    const openTickers = new Set(open.map((row) => String(row.ticker)))
    for (const row of open) {
      const quote = live.quotes[String(row.ticker)]; if (!quote) continue
      const state: OpenRecommendationState = { id: String(row.id), ticker: String(row.ticker), buyPrice: Number(row.buy_price), stopPrice: Number(row.stop_price), maxFavorablePct: row.max_favorable_pct == null ? null : Number(row.max_favorable_pct), maxAdversePct: row.max_adverse_pct == null ? null : Number(row.max_adverse_pct) }
      const decision = evaluateExit(state, scans.get(state.ticker), quote, now)
      if (decision.signal && decision.type) {
        await db("rpc/close_recommendation", { method: "POST", body: JSON.stringify({ p_recommendation_id: state.id, p_event_type: decision.type, p_signal_at: new Date(quote.timestamp).toISOString(), p_sell_price: quote.price, p_sell_reason: decision.reason, p_vnindex_exit: live.vnindex, p_provider: "DNSE", p_engine_version: SIGNAL_ENGINE_VERSION, p_volume: quote.totalVolume, p_rel_volume: decision.volumePace, p_max_favorable_pct: decision.maxFavorablePct, p_max_adverse_pct: decision.maxAdversePct, p_idempotency_key: `exit:${state.ticker}:${runKey}`, p_notification_payload: { ticker: state.ticker, type: decision.type, reason: decision.reason }, p_notion_payload: { ticker: state.ticker } }) }); exitCount++
      } else await db(`trade_recommendations?id=eq.${state.id}`, { method: "PATCH", body: JSON.stringify({ last_monitor_at: new Date(quote.timestamp).toISOString(), last_price: quote.price, last_rel_volume: decision.volumePace, max_favorable_pct: decision.maxFavorablePct, max_adverse_pct: decision.maxAdversePct }) })
    }
    for (const scan of bullish) {
      if (openTickers.has(scan.ticker)) continue
      const quote = live.quotes[scan.ticker]; if (!quote) continue
      const decision = evaluateBuy(scan, quote, now); if (!decision.signal || decision.stopPrice == null || decision.riskPct == null) continue
      const result = await db("rpc/create_buy_signal", { method: "POST", body: JSON.stringify({ p_ticker: scan.ticker, p_signal_at: new Date(quote.timestamp).toISOString(), p_buy_price: quote.price, p_buy_reason: decision.reason, p_stop_price: decision.stopPrice, p_risk_pct: decision.riskPct, p_initial_target: decision.targetPrice, p_vnindex_entry: live.vnindex, p_daily_bias: scan.taBias, p_scan_date: scan.date, p_confidence: scan.confidence || "LOW", p_provider: "DNSE", p_engine_version: SIGNAL_ENGINE_VERSION, p_volume: quote.totalVolume, p_rel_volume: decision.volumePace, p_idempotency_key: `buy:${scan.ticker}:${runKey}`, p_notification_payload: { ticker: scan.ticker, type: "BUY", reason: decision.reason }, p_notion_payload: { ticker: scan.ticker } }) })
      if (result?.[0]?.result === "created") buyCount++
    }
    if (runId) await db(`monitor_runs?id=eq.${runId}`, { method: "PATCH", body: JSON.stringify({ status: "succeeded", finished_at: new Date().toISOString(), candidate_count: bullish.length, open_count: open.length, quote_count: Object.keys(live.quotes).length, buy_count: buyCount, exit_count: exitCount, missing_quote_count: symbols.length - Object.keys(live.quotes).length, provider: "DNSE" }) })
    return response({ ok: true, session, candidates: bullish.length, open: open.length, quotes: Object.keys(live.quotes).length, buys: buyCount, exits: exitCount, providerDetail: live.detail })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (runId) await db(`monitor_runs?id=eq.${runId}`, { method: "PATCH", body: JSON.stringify({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 1000) }) }).catch(() => undefined)
    console.error("signal-monitor failed", message)
    return response({ ok: false, error: message, engineVersion: SIGNAL_ENGINE_VERSION }, 500)
  }
})
