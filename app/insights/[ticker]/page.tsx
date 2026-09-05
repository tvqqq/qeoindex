import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import { StockDetailWorkstation } from "@/components/stock-detail/stock-detail-workstation"
import { getServerAuthContext } from "@/modules/auth/server"
import { fetchStockDetailData } from "@/modules/research/insights/stock-detail-data"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>
}): Promise<Metadata> {
  const { ticker } = await params
  let decoded = decodeURIComponent(ticker).trim().toUpperCase()
  if (decoded === "TICKER" || !decoded) decoded = "HPG"

  return {
    title: `${decoded} — Chi tiết Cổ phiếu — QeoIndex`,
    description: `Phân tích toàn diện cổ phiếu ${decoded}: Hội đồng AI Council, TradingView chart, Wyckoff, TA và thông tin doanh nghiệp.`,
    alternates: { canonical: `/insights/${decoded.toLowerCase()}` },
  }
}

export default async function InsightsTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  const { ticker } = await params
  let decoded = decodeURIComponent(ticker).trim().toUpperCase()
  if (decoded === "TICKER" || !decoded) {
    decoded = "HPG"
  }

  const stockDetailData = await fetchStockDetailData(decoded, auth.supabase)

  return <StockDetailWorkstation data={stockDetailData} />
}
