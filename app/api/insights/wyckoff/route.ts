import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"
import { getCachedDailyHistory, getCachedHourlyHistory, getCachedLongDailyHistory } from "@/lib/request-cache"
import { getScannerData, rowToPreviousResult } from "@/lib/scanner-data"
import type { OhlcvBar } from "@/lib/technical-indicators"
import { getWyckoffCompanyMetadata } from "@/lib/wyckoff-company-metadata"
import { buildWyckoffChartStudies } from "@/lib/wyckoff-chart-model"
import { getUnifiedWyckoffTickerData } from "@/lib/wyckoff-unified-data"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

function vietnamDateKey(timestampSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampSeconds * 1000))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function alignDailyBars(bars: OhlcvBar[], scanDate?: string) {
  if (!scanDate) return bars
  return bars.filter((bar) => vietnamDateKey(bar.time) <= scanDate)
}

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      { ok: false, error: "Invalid ticker." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  let data = await getUnifiedWyckoffTickerData(auth.context.supabase, ticker)

  if (!data) {
    try {
      const scanner = await getScannerData()
      const dailyScan = scanner.latestScans[ticker]
      const metadataPromise = getWyckoffCompanyMetadata(auth.context.supabase, [ticker])

      const [dailyResult, hourlyResult] = await Promise.allSettled([
        getCachedLongDailyHistory(ticker),
        getCachedHourlyHistory(ticker),
      ])

      let daily = dailyResult.status === "fulfilled" ? dailyResult.value : null
      if (!daily) {
        try {
          daily = await getCachedDailyHistory(ticker)
        } catch {
          // Fallback failed
        }
      }
      const hourly = hourlyResult.status === "fulfilled" ? hourlyResult.value : null

      const dailyBars = alignDailyBars(daily?.bars ?? [], dailyScan?.date)
      const studies = buildWyckoffChartStudies({
        dailyBars,
        hourlyBars: hourly?.bars ?? [],
        dailyProvider: daily?.provider ?? "Unavailable",
        dailyDetail: daily?.detail ?? "Daily provider unavailable",
        hourlyProvider: hourly?.provider ?? "Unavailable",
        hourlyDetail: hourly?.detail ?? "1H provider unavailable",
        dailyAnalysis: rowToPreviousResult(dailyScan),
      })

      const companyMetadata = await metadataPromise
      const selectedMetadata = companyMetadata.get(ticker)

      data = {
        ticker,
        companyName: selectedMetadata?.companyName ?? ticker,
        exchange: selectedMetadata?.exchange ?? "HOSE",
        studies,
        generatedAt: scanner.generatedAt,
      }
    } catch (fallbackError) {
      console.error(`[QeoIndex Wyckoff API] Fallback failed for ${ticker}:`, fallbackError)
    }
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Wyckoff data is unavailable for this ticker." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      data,
      ticker: data.ticker,
      companyName: data.companyName,
      exchange: data.exchange,
      studies: data.studies,
      generatedAt: data.generatedAt,
    },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
  )
}
