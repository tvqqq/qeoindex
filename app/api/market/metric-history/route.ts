import { NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { displayedMarketMetricDay } from "@/modules/market/board/market-context-retention"
import { previousTradingSessionDateKey } from "@/modules/market/board/market-context-metrics"
import { buildBoardMetricReplay, type PersistedBoardMetric } from "@/modules/market/board/metric-replay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 10

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}

export async function GET() {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response
  const now = new Date()
  const day = displayedMarketMetricDay(now)
  const previousDay = previousTradingSessionDateKey(day)
  if (!day) return NextResponse.json({ ok: true, ...buildBoardMetricReplay([], day, now) }, { headers: HEADERS })

  try {
    // 247 HOSE trading minutes * 2 types * 2 sessions <= 988 rows; no user
    // writes or provider calls. Production pg_cron populates this when idle.
    const { data, error } = await auth.context.supabase
      .from("market_board_intraday_minutes")
      .select("session_date,minute_at,source_as_of,kind,source,traded_value,volume,buy_value,sell_value,covered_symbols")
      .in("session_date", previousDay ? [previousDay, day] : [day])
      .order("minute_at", { ascending: true })
      .limit(1000)
    if (error) throw error
    const history = buildBoardMetricReplay((data ?? []) as PersistedBoardMetric[], day, now)
    return NextResponse.json({ ok: true, ...history }, { headers: HEADERS })
  } catch {
    // Browser remains on verified observed local samples until DB promotion.
    return NextResponse.json({ ok: false, error: "SERVER_METRIC_HISTORY_UNAVAILABLE" },
      { status: 503, headers: HEADERS })
  }
}
