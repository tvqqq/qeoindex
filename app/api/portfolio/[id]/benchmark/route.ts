import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getPortfolioPerformanceContext } from "@/modules/portfolio/performance/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id: portfolioId } = await params
  const performance = await getPortfolioPerformanceContext(auth.context, portfolioId)
  const benchmark = performance.benchmark

  return NextResponse.json({
    ok: true,
    dataPoints: benchmark.points.map((point) => ({
      date: point.date,
      portfolioReturnPct: point.portfolioReturnPercent,
      vnindexReturnPct: point.vnindexReturnPercent,
    })),
    portfolioReturnPct: benchmark.portfolioReturnPercent,
    vnindexReturnPct: benchmark.vnindexReturnPercent,
    alphaPct: benchmark.alphaPercent,
    completeness: benchmark.completeness,
    reason: benchmark.reason,
  }, { headers: NO_STORE })
}
