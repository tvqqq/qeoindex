import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import { InsightsDashboard } from "@/components/insights/insights-dashboard"
import { getServerAuthContext } from "@/modules/auth/server"
import { loadVn30FuturesBasisPulseLatest } from "@/modules/research/market-insight/futures-basis-loader"
import { getInsightsDashboardData } from "@/modules/research/insights/data"
import { normalizeInsightsDashboardSectors } from "@/modules/research/insights/sector-normalization"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Insights thị trường — QeoIndex",
  description: "Tổng quan VNIndex, rating cổ phiếu và các mô-đun nghiên cứu thị trường của QeoIndex.",
  alternates: { canonical: "/insights" },
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams?: Promise<{ ticker?: string | string[]; rating?: string | string[] }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  const query = searchParams ? await searchParams : {}
  const requestedTicker = (Array.isArray(query.ticker) ? query.ticker[0] : query.ticker || (Array.isArray(query.rating) ? query.rating[0] : query.rating) || "").trim().toUpperCase()
  const [dashboardData, futuresBasisPulse] = await Promise.all([
    getInsightsDashboardData(auth.supabase),
    loadVn30FuturesBasisPulseLatest(auth.supabase).catch(() => null),
  ])
  const data = normalizeInsightsDashboardSectors(dashboardData)
  if (data.marketClose) {
    Object.assign(data.marketClose, {
      futuresBasisPulse: futuresBasisPulse?.sessionDate === data.marketClose.sessionDate ? futuresBasisPulse : null,
    })
  }
  return <InsightsDashboard data={data} initialTicker={requestedTicker} />
}
