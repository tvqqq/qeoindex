import { NextRequest, NextResponse } from "next/server"
import { vietnamDateKey } from "@/lib/dnse-history"
import { fetchDailyMarketHistory } from "@/lib/market-history"
import { getScannerData } from "@/lib/scanner-data"

export const dynamic = "force-dynamic"
export const maxDuration = 60

async function sampleHealth(symbol: string) {
  const result = await fetchDailyMarketHistory(symbol)
  const latest = result.bars.at(-1)
  return {
    ticker: symbol,
    provider: result.provider,
    providerDetail: result.detail,
    completedDailyBars: result.bars.length,
    latestCompletedDate: latest ? vietnamDateKey(latest.time * 1000) : null,
    sufficientForMA200: result.bars.length >= 200,
  }
}

export async function GET(request: NextRequest) {
  const coverage = new URL(request.url).searchParams.get("coverage") === "1"
  if (!coverage) {
    try {
      const sample = await sampleHealth("HPG")
      return NextResponse.json({ ok: sample.sufficientForMA200, sample }, { status: sample.sufficientForMA200 ? 200 : 503 })
    } catch (error) {
      return NextResponse.json({
        ok: false,
        sample: "HPG",
        error: error instanceof Error ? error.message.slice(0, 520) : "Unknown provider error",
      }, { status: 502 })
    }
  }

  const ready: Array<Awaited<ReturnType<typeof sampleHealth>>> = []
  const insufficient: Array<Awaited<ReturnType<typeof sampleHealth>>> = []
  const errors: Array<{ ticker: string; error: string }> = []
  const universe = (await getScannerData()).universe

  for (let start = 0; start < universe.length; start += 10) {
    const batch = universe.slice(start, start + 10)
    const outcomes = await Promise.allSettled(batch.map((stock) => sampleHealth(stock.ticker)))
    outcomes.forEach((outcome, index) => {
      const ticker = batch[index].ticker
      if (outcome.status === "rejected") {
        errors.push({ ticker, error: outcome.reason instanceof Error ? outcome.reason.message.slice(0, 240) : String(outcome.reason).slice(0, 240) })
      } else if (outcome.value.sufficientForMA200) {
        ready.push(outcome.value)
      } else {
        insufficient.push(outcome.value)
      }
    })
  }

  return NextResponse.json({
    ok: ready.length === universe.length,
    universe: universe.length,
    readyCount: ready.length,
    insufficientCount: insufficient.length,
    errorCount: errors.length,
    providerCounts: ready.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = (acc[row.provider] ?? 0) + 1
      return acc
    }, {}),
    insufficient,
    errors,
  }, { status: errors.length || insufficient.length ? 207 : 200 })
}
