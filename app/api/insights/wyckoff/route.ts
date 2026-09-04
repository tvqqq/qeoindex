import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getCanonicalUniverse, type CanonicalUniverseSnapshot } from "@/modules/market/universe/index"
import { getCachedDailyHistory, getCachedLongDailyHistory } from "@/modules/shared/cache/request-cache"
import { buildWyckoffChartStudies } from "@/modules/wyckoff/chart-model"
import { getUnifiedWyckoffTickerData } from "@/modules/wyckoff/unified-data"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/
const QUERY_CHUNK_SIZE = 100

interface WatchlistSnapshotRow {
  ticker: string
  timeframe: "1D" | "1W"
  bar_closed_at: string | null
  history_status: string | null
  phase: string | null
  ta_bias: string | null
  confidence: string | null
  technical: Record<string, unknown> | null
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

async function loadCanonicalWatchlist(supabase: SupabaseClient, canonical: CanonicalUniverseSnapshot) {
  const rows: WatchlistSnapshotRow[] = []
  const tickers = canonical.stocks.map((stock) => stock.ticker)
  for (let offset = 0; offset < tickers.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = tickers.slice(offset, offset + QUERY_CHUNK_SIZE)
    const result = await supabase
      .from("wyckoff_latest_by_timeframe")
      .select("ticker,timeframe,bar_closed_at,history_status,phase,ta_bias,confidence,technical")
      .in("timeframe", ["1D", "1W"])
      .in("ticker", chunk)
    if (result.error) throw new Error(`Load Wyckoff watchlist failed: ${result.error.message}`)
    rows.push(...(result.data || []) as WatchlistSnapshotRow[])
  }

  const byKey = new Map(rows.map((row) => [`${row.ticker}|${row.timeframe}`, row] as const))
  return canonical.stocks.map((stock) => {
    const row1D = byKey.get(`${stock.ticker}|1D`)
    const row1W = byKey.get(`${stock.ticker}|1W`)
    return {
      ticker: stock.ticker,
      rank: stock.rank,
      sector: stock.sector || "",
      price: finiteNumber(row1D?.technical?.price),
      changePct: finiteNumber(row1D?.technical?.changePct),
      phase: row1D?.phase || "",
      phase1D: row1D?.phase || "",
      phase1W: row1W?.phase || "",
      bias: row1D?.ta_bias || "",
      confidence: row1D?.confidence || "",
      status: row1D ? (row1D.history_status === "complete" ? "Complete" : "Incomplete") : "Pending",
      date: row1D?.bar_closed_at?.slice(0, 10) || "",
    }
  })
}

async function buildOnDemandTickerData(
  ticker: string,
  member: CanonicalUniverseSnapshot["stocks"][number],
) {
  let daily = null as Awaited<ReturnType<typeof getCachedLongDailyHistory>> | null
  try {
    daily = await getCachedLongDailyHistory(ticker)
  } catch {
    try {
      daily = await getCachedDailyHistory(ticker)
    } catch {
      daily = null
    }
  }
  if (!daily?.bars.length) return null

  const studies = buildWyckoffChartStudies({
    dailyBars: daily.bars,
    dailyProvider: daily.provider,
    dailyDetail: daily.detail,
  })
  const latestSeconds = daily.bars.at(-1)?.time ?? 0

  return {
    ticker,
    companyName: member.companyName || ticker,
    exchange: member.exchange || "",
    sector: member.sector || "",
    studies,
    generatedAt: latestSeconds > 0 ? new Date(latestSeconds * 1000).toISOString() : new Date().toISOString(),
  }
}

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const canonical = await getCanonicalUniverse()

  if (url.searchParams.get("mode") === "watchlist") {
    const stocks = await loadCanonicalWatchlist(auth.context.supabase, canonical)
    return NextResponse.json(
      { ok: true, stocks, generatedAt: canonical.updatedAt, universeRunId: canonical.runId },
      { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
    )
  }

  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Invalid ticker." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  const member = canonical.stocks.find((stock) => stock.ticker === ticker)
  if (!member) {
    return NextResponse.json({ ok: false, error: `${ticker} không thuộc canonical Top Stocks hiện tại.` }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  let data = await getUnifiedWyckoffTickerData(auth.context.supabase, ticker)
  if (!data) data = await buildOnDemandTickerData(ticker, member)
  if (!data) {
    return NextResponse.json({ ok: false, error: "Wyckoff data is unavailable for this ticker." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } })
}
