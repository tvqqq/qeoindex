import { NextResponse } from "next/server"
import { vietnamDateKey } from "@/lib/dnse-history"
import { fetchDailyMarketHistory } from "@/lib/market-history"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const result = await fetchDailyMarketHistory("HPG")
    const latest = result.bars.at(-1)
    return NextResponse.json({
      ok: result.bars.length >= 200,
      provider: result.provider,
      providerDetail: result.detail,
      sample: "HPG",
      completedDailyBars: result.bars.length,
      latestCompletedDate: latest ? vietnamDateKey(latest.time * 1000) : null,
      sufficientForMA200: result.bars.length >= 200,
    }, { status: result.bars.length >= 200 ? 200 : 503 })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      sample: "HPG",
      error: error instanceof Error ? error.message.slice(0, 520) : "Unknown provider error",
    }, { status: 502 })
  }
}
