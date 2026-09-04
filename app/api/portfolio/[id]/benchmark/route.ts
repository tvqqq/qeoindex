import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { computePortfolioPositions, RawTransaction } from "@/modules/portfolio/pnl"
import { fetchDnseIndexCandleHistory } from "@/modules/market/providers/dnse/index-candles"
import { CandleBar } from "@/modules/market/realtime/index-candles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id: portfolioId } = await params

  // 1. Fetch transactions for this portfolio using canonical risk-management fields only.
  const { data: transactions, error: txErr } = await auth.context.supabase
    .from("portfolio_transactions")
    .select("id,ticker,action,quantity,price,fee,transaction_date,tags,setup_tags,mistake_tags,target_price_1,target_price_2,target_price_3,stop_loss_1,stop_loss_2,stop_loss_3")
    .eq("portfolio_id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .order("transaction_date", { ascending: true })

  if (txErr || !transactions || transactions.length === 0) {
    return NextResponse.json({
      ok: true,
      dataPoints: [],
      portfolioReturnPct: 0,
      vnindexReturnPct: 0,
      alphaPct: 0,
    }, { headers: NO_STORE })
  }

  // 2. Fetch VNINDEX daily candles
  const now = new Date()
  const historyRes = await fetchDnseIndexCandleHistory("VNINDEX", now, "1D").catch(() => null)
  const vnindexCandles: CandleBar[] = historyRes?.bars ?? []

  if (vnindexCandles.length === 0) {
    return NextResponse.json({
      ok: true,
      dataPoints: [],
      portfolioReturnPct: 0,
      vnindexReturnPct: 0,
      alphaPct: 0,
    }, { headers: NO_STORE })
  }

  // 3. Determine start date from earliest transaction
  const startDate = transactions[0].transaction_date
  const filteredIndexCandles = vnindexCandles.filter((c) => {
    const d = new Date(c.time * 1000).toISOString().split("T")[0]
    return d >= startDate
  })

  if (filteredIndexCandles.length === 0) {
    return NextResponse.json({
      ok: true,
      dataPoints: [],
      portfolioReturnPct: 0,
      vnindexReturnPct: 0,
      alphaPct: 0,
    }, { headers: NO_STORE })
  }

  const baseIndexPrice = filteredIndexCandles[0].close || 1

  // 4. Compute progressive portfolio cumulative realized & cost over time
  const dataPoints: Array<{
    date: string
    portfolioReturnPct: number
    vnindexReturnPct: number
  }> = []

  for (const bar of filteredIndexCandles) {
    const dateStr = new Date(bar.time * 1000).toISOString().split("T")[0]
    const currentVnindex = bar.close
    const vnindexReturnPct = Number((((currentVnindex - baseIndexPrice) / baseIndexPrice) * 100).toFixed(2))

    const txsUpToDate = transactions.filter((t) => t.transaction_date <= dateStr) as RawTransaction[]
    const summary = computePortfolioPositions(txsUpToDate)

    const investedCapital = summary.positions.reduce((s, p) => s + p.totalInvested, 0)
    const realized = summary.totalRealizedPnl

    const totalBasis = Math.max(investedCapital, 1000)
    const portReturnPct = Number(((realized / totalBasis) * 100).toFixed(2))

    dataPoints.push({
      date: dateStr,
      portfolioReturnPct: portReturnPct,
      vnindexReturnPct,
    })
  }

  const lastPoint = dataPoints[dataPoints.length - 1]
  const portfolioReturnPct = lastPoint?.portfolioReturnPct ?? 0
  const vnindexReturnPct = lastPoint?.vnindexReturnPct ?? 0
  const alphaPct = Number((portfolioReturnPct - vnindexReturnPct).toFixed(2))

  return NextResponse.json({
    ok: true,
    dataPoints,
    portfolioReturnPct,
    vnindexReturnPct,
    alphaPct,
  }, { headers: NO_STORE })
}
