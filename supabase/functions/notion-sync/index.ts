import { authorize, db, json, retryPatch } from "../_shared/outbox.ts"

type Work = { id: string; entity_type: "trade_recommendation" | "signal_event" | "daily_scan"; entity_id: string; operation: "create" | "update"; attempt_count: number }

const notionVersion = "2026-03-11"
const token = Deno.env.get("NOTION_API_KEY") ?? ""
const notionApiBase = (Deno.env.get("NOTION_API_BASE_URL")?.trim() || "https://api.notion.com/v1").replace(/\/$/, "")

function rich(value: unknown) { const text = String(value ?? ""); return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 1900) } }] : [] } }
function title(value: unknown) { return { title: [{ type: "text", text: { content: String(value).slice(0, 1900) } }] } }
function num(value: unknown) { const parsed = Number(value); return { number: value != null && Number.isFinite(parsed) ? parsed : null } }
function date(value: unknown) { return value ? { date: { start: String(value) } } : { date: null } }
function select(value: unknown) { return value ? { select: { name: String(value) } } : { select: null } }

async function notion(path: string, init: RequestInit) {
  const result = await fetch(`${notionApiBase}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "notion-version": notionVersion, "content-type": "application/json", ...init.headers } })
  const payload = await result.json()
  if (!result.ok) throw new Error(`Notion request failed (${result.status}): ${String(payload.message ?? "unknown")}`)
  return payload
}

function recommendationProperties(row: Record<string, unknown>) {
  return {
    Recommendation: title(`${row.ticker} — BUY — ${String(row.buy_signal_at).slice(0, 16)}`), Ticker: rich(row.ticker),
    Status: select(String(row.status).replace(/^./, (value) => value.toUpperCase())), "Buy Signal": date(row.buy_signal_at), "Buy Price": num(row.buy_price),
    "Buy Reason": rich(row.buy_reason), "Stop Price": num(row.stop_price), "Risk Pct": num(row.risk_pct), "Initial Target": num(row.initial_target),
    "Sell Signal": date(row.sell_signal_at), "Sell Price": num(row.sell_price), "Sell Reason": rich(row.sell_reason), "Return Pct": num(row.return_pct),
    "VNINDEX Entry": num(row.vnindex_entry), "VNINDEX Exit": num(row.vnindex_exit), "VNINDEX Return Pct": num(row.vnindex_return_pct), "Alpha Pct": num(row.alpha_pct),
    Outcome: select(String(row.outcome).replace(/^./, (value) => value.toUpperCase())), "Daily Bias": select(row.daily_bias), "Scan Date": date(row.scan_date),
    Confidence: select(row.confidence), Provider: select(row.provider), "Engine Version": rich(row.engine_version), "Last Monitor": date(row.last_monitor_at),
    "Last Price": num(row.last_price), "Last Rel Volume": num(row.last_rel_volume), "Max Favorable Pct": num(row.max_favorable_pct), "Max Adverse Pct": num(row.max_adverse_pct),
  }
}

function eventProperties(row: Record<string, unknown>, recommendationPageId: string) {
  return {
    Signal: title(`${row.ticker} — ${row.event_type} — ${String(row.signal_at).slice(0, 16)}`), Ticker: rich(row.ticker), Type: select(row.event_type),
    "Signal Time": date(row.signal_at), Price: num(row.price), Volume: num(row.volume), "Rel Volume": num(row.rel_volume), Rule: rich(row.rule),
    Recommendation: { relation: [{ id: recommendationPageId }] }, "Engine Version": rich(row.engine_version), Provider: select(row.provider),
    "Scan Date": date(row.scan_date), "Daily Bias": select(row.daily_bias), "Stop Price": num(row.stop_price), VNINDEX: num(row.vnindex),
  }
}

function dailyScanProperties(row: Record<string, unknown>) {
  return {
    Scan: title(`${row.ticker} — Daily Scan — ${row.scan_date}`), Ticker: rich(row.ticker), Date: date(row.scan_date), Rank: num(row.rank),
    Price: num(row.price), "Change Pct": num(row.change_pct), Volume: num(row.volume), RSI14: num(row.rsi14), MACD: num(row.macd),
    "MACD Signal": num(row.macd_signal), MA20: num(row.ma20), MA50: num(row.ma50), MA200: num(row.ma200), ATR14: num(row.atr14),
    "Rel Volume": num(row.rel_volume), "Wyckoff State": rich(row.wyckoff_state), Phase: rich(row.phase), "TA Bias": select(row.ta_bias),
    "Bull Probability": num(row.bull_probability), "Base Probability": num(row.base_probability), "Bear Probability": num(row.bear_probability),
    Support: rich(row.support), Resistance: rich(row.resistance), Confirmation: rich(row.confirmation), Invalidation: rich(row.invalidation),
    "What Changed": rich(row.what_changed), Confidence: select(row.confidence), Provider: select(row.provider), Status: select(row.status),
  }
}

async function sync(item: Work, recommendationSource: string, eventSource: string, scanSource: string) {
  const table = item.entity_type === "trade_recommendation" ? "trade_recommendations" : item.entity_type === "signal_event" ? "signal_events" : "daily_scans"
  const rows = await db(`${table}?id=eq.${item.entity_id}&select=*`)
  const row = rows?.[0] as Record<string, unknown> | undefined
  if (!row) throw new Error(`${item.entity_type} not found`)
  let properties: Record<string, unknown>
  if (item.entity_type === "trade_recommendation") properties = recommendationProperties(row)
  else if (item.entity_type === "daily_scan") properties = dailyScanProperties(row)
  else {
    const recs = await db(`trade_recommendations?id=eq.${row.recommendation_id}&select=notion_page_id`)
    const recommendationPageId = recs?.[0]?.notion_page_id
    if (!recommendationPageId) throw new Error("Recommendation Notion page is not synced yet")
    properties = eventProperties(row, recommendationPageId)
  }
  const existingPageId = row.notion_page_id ? String(row.notion_page_id) : ""
  if (item.operation === "update" && !existingPageId) throw new Error("Notion page mapping is missing")
  const page = existingPageId
    ? await notion(`pages/${existingPageId}`, { method: "PATCH", body: JSON.stringify({ properties }) })
    : await notion("pages", { method: "POST", body: JSON.stringify({ parent: { data_source_id: item.entity_type === "trade_recommendation" ? recommendationSource : item.entity_type === "signal_event" ? eventSource : scanSource }, properties }) })
  if (!existingPageId) await db(`${table}?id=eq.${item.entity_id}`, { method: "PATCH", body: JSON.stringify({ notion_page_id: page.id }) })
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  if (!authorize(request)) return json({ ok: false, error: "Unauthorized" }, 401)
  const recommendationSource = Deno.env.get("NOTION_TRADE_RECOMMENDATIONS_DATA_SOURCE_ID") ?? ""
  const eventSource = Deno.env.get("NOTION_SIGNAL_EVENTS_DATA_SOURCE_ID") ?? ""
  const scanSource = Deno.env.get("NOTION_DAILY_WYCKOFF_SCAN_DATA_SOURCE_ID") ?? ""
  if (!token || !recommendationSource || !eventSource || !scanSource) return json({ ok: false, error: "Notion sync is not configured" }, 503)
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number }
    const limit = Math.max(1, Math.min(Number(body.limit) || 10, 25))
    const claimed = (await db("rpc/claim_notion_sync_outbox", { method: "POST", body: JSON.stringify({ p_limit: limit }) }) ?? []) as Work[]
    claimed.sort((left, right) => {
      const priority = (item: Work) => item.entity_type === "signal_event" ? 2 : item.operation === "create" ? 0 : 1
      return priority(left) - priority(right)
    })
    let synced = 0; const failures: Array<{ id: string; error: string }> = []
    for (const item of claimed) {
      try {
        await sync(item, recommendationSource, eventSource, scanSource)
        await db(`notion_sync_outbox?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "synced", synced_at: new Date().toISOString(), last_error: null }) })
        synced++
      } catch (error) {
        await db(`notion_sync_outbox?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify(retryPatch(item.attempt_count, error)) })
        failures.push({ id: item.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return json({ ok: failures.length === 0, claimed: claimed.length, synced, failures }, failures.length ? 207 : 200)
  } catch (error) {
    console.error("notion-sync failed", error)
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
