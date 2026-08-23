import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import type { WyckoffListItem } from "@/components/insights/wyckoff-chart-dashboard"
import { WyckoffInfographicDashboard } from "@/components/insights/wyckoff-infographic-dashboard"
import { NotionUnavailable } from "@/components/notion-unavailable"
import { getServerAuthContext } from "@/lib/auth/server"
import { getCachedDailyHistory, getCachedHourlyHistory, getCachedLongDailyHistory } from "@/lib/request-cache"
import { getScannerData, rowToPreviousResult } from "@/lib/scanner-data"
import type { OhlcvBar } from "@/lib/technical-indicators"
import { getWyckoffCompanyMetadata } from "@/lib/wyckoff-company-metadata"
import { buildWyckoffChartStudies, isWyckoffChartTimeframe, type WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"
import { getUnifiedWyckoffData } from "@/lib/wyckoff-unified-data"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Phân tích chart Wyckoff — QeoIndex",
  description: "Chart Wyckoff đa khung thời gian và Top 100 cổ phiếu QeoIndex.",
  alternates: { canonical: "/insights/wyckoff" },
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

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

export default async function WyckoffChartPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[]; timeframe?: string | string[] }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  const query = await searchParams
  const requestedTicker = (first(query.ticker) ?? "").trim().toUpperCase()
  const requestedTimeframe = first(query.timeframe)
  const initialTimeframe: WyckoffChartTimeframe = isWyckoffChartTimeframe(requestedTimeframe) ? requestedTimeframe : "1D"

  let unified: Awaited<ReturnType<typeof getUnifiedWyckoffData>> = null
  try {
    unified = await getUnifiedWyckoffData(auth.supabase, requestedTicker)
  } catch (error) {
    console.error("[QeoIndex Wyckoff chart] unified read failed; using compatibility fallback", error)
  }
  if (unified) {
    return <WyckoffInfographicDashboard {...unified} initialTimeframe={initialTimeframe} dataSource="Supabase unified" />
  }

  let scanner: Awaited<ReturnType<typeof getScannerData>>
  try {
    scanner = await getScannerData()
  } catch (error) {
    console.error("[QeoIndex Wyckoff chart] canonical scanner read failed", error)
    return <NotionUnavailable section="Phân tích chart Wyckoff" detail="Không đọc được canonical Top 100 / Daily Wyckoff Scan từ Notion. Page không thay thế scan bằng dữ liệu giả hoặc snapshot không rõ nguồn." />
  }

  const selectedStock = scanner.universe.find((stock) => stock.ticker === requestedTicker) ?? scanner.universe[0]
  const ticker = selectedStock.ticker
  const dailyScan = scanner.latestScans[ticker]
  const metadataPromise = getWyckoffCompanyMetadata(auth.supabase, [ticker])

  const [dailyResult, hourlyResult] = await Promise.allSettled([
    getCachedLongDailyHistory(ticker),
    getCachedHourlyHistory(ticker),
  ])

  let daily = dailyResult.status === "fulfilled" ? dailyResult.value : null
  if (!daily) {
    try {
      daily = await getCachedDailyHistory(ticker)
    } catch (error) {
      const longHistoryError = dailyResult.status === "rejected" ? dailyResult.reason : "Long Daily history returned no result"
      console.error(`[QeoIndex Wyckoff chart] ${ticker} Daily history failed`, longHistoryError, error)
    }
  }
  const hourly = hourlyResult.status === "fulfilled" ? hourlyResult.value : null
  if (!hourly) {
    const hourlyError = hourlyResult.status === "rejected" ? hourlyResult.reason : "Hourly history returned no result"
    console.error(`[QeoIndex Wyckoff chart] ${ticker} Hourly history failed`, hourlyError)
  }

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
  const stocks: WyckoffListItem[] = scanner.universe.map((stock) => {
    const scan = scanner.latestScans[stock.ticker]
    return {
      ticker: stock.ticker,
      rank: stock.rank,
      sector: stock.sector,
      price: scan?.price ?? null,
      changePct: scan?.changePct ?? null,
      phase: scan?.phase ?? "",
      bias: scan?.taBias ?? "",
      confidence: scan?.confidence ?? "",
      status: scan?.status ?? "Pending",
      date: scan?.date ?? "",
    }
  })

  return (
    <WyckoffInfographicDashboard
      ticker={ticker}
      companyName={selectedMetadata?.companyName ?? ticker}
      exchange={selectedMetadata?.exchange ?? "HOSE"}
      studies={studies}
      initialTimeframe={initialTimeframe}
      stocks={stocks}
      generatedAt={scanner.generatedAt}
      dataSource="Notion compatibility"
    />
  )
}
