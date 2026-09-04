import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/
const DAILY_HISTORY_LIMIT = 180

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Invalid ticker." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  const [daily, quarterly] = await Promise.all([
    auth.context.supabase
      .from("insights_stock_ratings")
      .select("as_of_date,kfsp_stock_rs_score,kfsp_sector_rs_score,rs_medium,kfsp_stock_rrg_state,kfsp_sector_rrg_state")
      .eq("ticker", ticker)
      .eq("source", "kfsp")
      .eq("is_published", true)
      .order("as_of_date", { ascending: false })
      .limit(DAILY_HISTORY_LIMIT),
    auth.context.supabase
      .from("kfsp_ttai_quarterly_history")
      .select("period,period_year,period_quarter,fourm_score,canslim_score,fourm_components,canslim_components,fetched_at")
      .eq("ticker", ticker)
      .order("period_year", { ascending: true })
      .order("period_quarter", { ascending: true }),
  ])

  if (daily.error) {
    return NextResponse.json(
      { ok: false, error: "Unable to load stock history." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }

  const dailyHistory = (daily.data || []).map((row) => ({
    asOfDate: row.as_of_date,
    stockRs: numberOrNull(row.kfsp_stock_rs_score),
    sectorRs: numberOrNull(row.kfsp_sector_rs_score),
    rsMedium: numberOrNull(row.rs_medium),
    stockRrgState: row.kfsp_stock_rrg_state || null,
    sectorRrgState: row.kfsp_sector_rrg_state || null,
  })).reverse()

  const quarterlyHistory = quarterly.error ? [] : (quarterly.data || []).map((row) => ({
    period: row.period,
    year: Number(row.period_year),
    quarter: Number(row.period_quarter),
    fourmScore: numberOrNull(row.fourm_score),
    canslimScore: numberOrNull(row.canslim_score),
    fourmComponents: row.fourm_components && typeof row.fourm_components === "object" ? row.fourm_components : {},
    canslimComponents: row.canslim_components && typeof row.canslim_components === "object" ? row.canslim_components : {},
    fetchedAt: row.fetched_at,
  }))

  return NextResponse.json(
    {
      ok: true,
      ticker,
      dailyHistory,
      quarterlyHistory,
      quarterlyHistoryAvailable: !quarterly.error,
    },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
  )
}
