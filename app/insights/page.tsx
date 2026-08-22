import type { Metadata } from "next"

import { InsightsHomepage } from "@/components/insights/insights-homepage"
import { TopNav } from "@/components/top-nav"
import { getInsightsHomepageData } from "@/lib/insights-data"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Insights — QeoIndex",
  description: "Tổng quan VNIndex, rating cổ phiếu, Wyckoff, tín hiệu, thesis và định giá trên QeoIndex.",
  alternates: { canonical: "/insights" },
}

export default async function InsightsPage() {
  const data = await getInsightsHomepageData()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <InsightsHomepage data={data} />
    </div>
  )
}
