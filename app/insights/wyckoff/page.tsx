import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import { WyckoffDeferredDashboard } from "@/components/insights/wyckoff-deferred-dashboard"
import type { WyckoffListItem } from "@/components/insights/wyckoff-chart-dashboard"
import { getServerAuthContext } from "@/lib/auth/server"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { isWyckoffChartTimeframe, type WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Phân tích chart Wyckoff — QeoIndex",
  description: "Chart Wyckoff Daily và Weekly cho canonical Top Stocks, tối đa 200 cổ phiếu QeoIndex.",
  alternates: { canonical: "/insights/wyckoff" },
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function WyckoffChartPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[]; timeframe?: string | string[] }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  const [query, canonical] = await Promise.all([searchParams, getCanonicalUniverse()])
  const requestedTicker = (first(query.ticker) ?? "").trim().toUpperCase()
  const requestedTimeframe = first(query.timeframe)
  const initialTimeframe: WyckoffChartTimeframe = isWyckoffChartTimeframe(requestedTimeframe) ? requestedTimeframe : "1D"
  const initialMember = canonical.stocks.find((stock) => stock.ticker === requestedTicker) ?? canonical.stocks[0]

  if (!initialMember) {
    return (
      <main className="min-h-screen bg-[#05080d] p-6 text-sm font-semibold text-slate-300">
        Canonical Top Stocks universe chưa có dữ liệu publish.
      </main>
    )
  }

  const initialStocks: WyckoffListItem[] = canonical.stocks.map((stock) => ({
    ticker: stock.ticker,
    rank: stock.rank,
    sector: stock.sector || "",
    price: null,
    changePct: null,
    phase: "",
    phase1D: "",
    phase1W: "",
    bias: "",
    confidence: "",
    status: "Pending",
    date: "",
  }))

  return (
    <WyckoffDeferredDashboard
      initialTicker={initialMember.ticker}
      initialTimeframe={initialTimeframe}
      initialStocks={initialStocks}
      generatedAt={canonical.updatedAt}
    />
  )
}
