import "server-only"

import type { SignalEventRow, TradeRecommendation } from "@/lib/signal-data"
import type { Database } from "@/lib/supabase/database.types"
import { supabaseAdminRead } from "@/lib/supabase/server"

type RecommendationRow = Database["public"]["Tables"]["trade_recommendations"]["Row"]
type EventRow = Database["public"]["Tables"]["signal_events"]["Row"]
export type OperationalBackend = "notion" | "supabase"

export function operationalBackend(): OperationalBackend {
  return process.env.STOCKOS_OPERATIONAL_BACKEND === "supabase" ? "supabase" : "notion"
}
function notionUrl(id: string | null) { return id ? `https://www.notion.so/${id.replaceAll("-", "")}` : "/research" }
function cap(value: string) { return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "" }
function mapRecommendation(row: RecommendationRow): TradeRecommendation {
  return { id: row.id, notionUrl: notionUrl(row.notion_page_id), ticker: row.ticker, status: cap(row.status) as TradeRecommendation["status"], buySignal: row.buy_signal_at, buyPrice: row.buy_price, buyReason: row.buy_reason, stopPrice: row.stop_price, riskPct: row.risk_pct, targetPrice: row.initial_target, sellSignal: row.sell_signal_at ?? "", sellPrice: row.sell_price, sellReason: row.sell_reason ?? "", returnPct: row.return_pct, vnindexEntry: row.vnindex_entry, vnindexExit: row.vnindex_exit, vnindexReturnPct: row.vnindex_return_pct, alphaPct: row.alpha_pct, outcome: cap(row.outcome) as TradeRecommendation["outcome"], dailyBias: row.daily_bias, scanDate: row.scan_date, confidence: row.confidence, provider: row.provider, telegramSent: false, engineVersion: row.engine_version, lastMonitor: row.last_monitor_at ?? "", lastPrice: row.last_price, lastRelVolume: row.last_rel_volume, maxFavorablePct: row.max_favorable_pct, maxAdversePct: row.max_adverse_pct }
}
function mapEvent(row: EventRow): SignalEventRow {
  return { id: row.id, notionUrl: notionUrl(row.notion_page_id), ticker: row.ticker, type: row.event_type, signalTime: row.signal_at, price: row.price, volume: row.volume, relVolume: row.rel_volume, rule: row.rule, telegramSent: false, provider: row.provider, scanDate: row.scan_date ?? "", dailyBias: row.daily_bias ?? "", stopPrice: row.stop_price, vnindex: row.vnindex }
}
export async function getSupabaseSignalLedger() {
  const [recommendations, events] = await Promise.all([
    supabaseAdminRead<RecommendationRow[]>("trade_recommendations?select=*&order=buy_signal_at.desc"),
    supabaseAdminRead<EventRow[]>("signal_events?select=*&order=signal_at.desc&limit=500"),
  ])
  return { recommendations: recommendations.map(mapRecommendation), events: events.map(mapEvent) }
}
