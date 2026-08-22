import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import { InsightsDashboard } from "@/components/insights/insights-dashboard"
import { getServerAuthContext } from "@/lib/auth/server"
import { getInsightsDashboardData } from "@/lib/insights-data"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Insights thị trường — QeoIndex",
  description: "Tổng quan VNIndex, rating cổ phiếu và các mô-đun nghiên cứu thị trường của QeoIndex.",
  alternates: { canonical: "/insights" },
}

export default async function InsightsPage() {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  const data = await getInsightsDashboardData(auth.supabase)
  return <InsightsDashboard data={data} />
}
