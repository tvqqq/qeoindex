import { NextRequest, NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { vietnamDateKey } from "@/modules/market/providers/dnse/history"
import { fetchDailyMarketHistory } from "@/modules/market/history/index"
import { getScannerData } from "@/modules/signals/scanner/data"
import { scannerHistoryPolicy, type ScannerHistoryStatus } from "@/modules/signals/scanner/policy"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type ScannerHealthStatus = ScannerHistoryStatus | "Rejected"

async function sampleHealth(symbol: string) {
  const result = await fetchDailyMarketHistory(symbol)
  const latest = result.bars.at(-1)
  let historyStatus: ScannerHealthStatus = "Rejected"
  let forceLowConfidence = false
  try {
    const policy = scannerHistoryPolicy(result.bars.length)
    historyStatus = policy.status
    forceLowConfidence = policy.forceLowConfidence
  } catch {
    // Provider history exists, but the canonical scanner policy rejects fewer than 60 completed Daily bars.
  }
  return {
    ticker: symbol,
    provider: result.provider,
    providerDetail: result.detail,
    completedDailyBars: result.bars.length,
    latestCompletedDate: latest ? vietnamDateKey(latest.time * 1000) : null,
    historyStatus,
    eligibleForScan: historyStatus !== "Rejected",
    forceLowConfidence,
    sufficientForMA200: historyStatus === "Complete",
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  const coverage = new URL(request.url).searchParams.get("coverage") === "1"
  if (!coverage) {
    try {
      const sample = await sampleHealth("HPG")
      return NextResponse.json({ ok: sample.eligibleForScan, sample }, { status: sample.eligibleForScan ? 200 : 503 })
    } catch (error) {
      return NextResponse.json({
        ok: false,
        sample: "HPG",
        error: error instanceof Error ? error.message.slice(0, 520) : "Unknown provider error",
      }, { status: 502 })
    }
  }

  const complete: Array<Awaited<ReturnType<typeof sampleHealth>>> = []
  const incomplete: Array<Awaited<ReturnType<typeof sampleHealth>>> = []
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
      } else if (outcome.value.historyStatus === "Complete") {
        complete.push(outcome.value)
      } else if (outcome.value.historyStatus === "Incomplete") {
        incomplete.push(outcome.value)
      } else {
        insufficient.push(outcome.value)
      }
    })
  }

  const scannable = [...complete, ...incomplete]
  return NextResponse.json({
    ok: errors.length === 0 && insufficient.length === 0,
    universe: universe.length,
    readyCount: scannable.length,
    completeCount: complete.length,
    incompleteCount: incomplete.length,
    insufficientCount: insufficient.length,
    errorCount: errors.length,
    providerCounts: scannable.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = (acc[row.provider] ?? 0) + 1
      return acc
    }, {}),
    incomplete,
    insufficient,
    errors,
  }, { status: errors.length || insufficient.length ? 207 : 200 })
}
