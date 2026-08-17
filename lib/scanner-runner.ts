import { vietnamDateKey } from "@/lib/dnse-history"
import { fetchDailyMarketHistory } from "@/lib/market-history"
import { notifyOpsError } from "@/lib/ops-alerts"
import { getScannerData, rowToPreviousResult, writeDailyScan } from "@/lib/scanner-data"
import { scanWyckoff } from "@/lib/wyckoff-engine"
import { UNIVERSE_SIZE } from "@/lib/wyckoff-universe"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ScannerRunSummary {
  ok: boolean
  universeDate: string
  requested: number
  completed: Array<{ ticker: string; provider: string; date: string }>
  skipped: string[]
  errors: Array<{ ticker: string; error: string }>
  generatedAt: string
}

export async function runScannerUniverse({ limit = UNIVERSE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<ScannerRunSummary> {
  const data = await getScannerData()
  const safeLimit = Math.max(1, Math.min(UNIVERSE_SIZE, limit))
  const safeOffset = Math.max(0, offset)
  const targets = data.universe.slice(safeOffset, safeOffset + safeLimit)

  const completed: ScannerRunSummary["completed"] = []
  const skipped: string[] = []
  const errors: ScannerRunSummary["errors"] = []

  for (let start = 0; start < targets.length; start += 5) {
    const batch = targets.slice(start, start + 5)
    const fetched = await Promise.allSettled(batch.map(async (stock) => {
      const historical = await fetchDailyMarketHistory(stock.ticker)
      const bars = historical.bars
      if (bars.length < 200) throw new Error(`Only ${bars.length} completed Daily bars; need >=200 for MA200 baseline`)
      const scanDate = vietnamDateKey(bars.at(-1)!.time * 1000)
      const previousRow = data.latestScans[stock.ticker]
      if (previousRow?.date === scanDate && previousRow.status === "Complete") {
        return { stock, scanDate, provider: historical.provider, skip: true as const, result: null }
      }
      const result = scanWyckoff(bars, rowToPreviousResult(previousRow))
      return { stock, scanDate, provider: historical.provider, skip: false as const, result }
    }))

    for (let i = 0; i < fetched.length; i += 1) {
      const outcome = fetched[i]
      const ticker = batch[i].ticker
      if (outcome.status === "rejected") {
        errors.push({ ticker, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) })
        continue
      }
      if (outcome.value.skip || !outcome.value.result) {
        skipped.push(ticker)
        continue
      }
      try {
        await writeDailyScan(ticker, outcome.value.stock.rank, outcome.value.scanDate, outcome.value.result, outcome.value.provider)
        completed.push({ ticker, provider: outcome.value.provider, date: outcome.value.scanDate })
      } catch (error) {
        errors.push({ ticker, error: error instanceof Error ? error.message : String(error) })
      }
      await sleep(380)
    }
  }

  const summary: ScannerRunSummary = {
    ok: errors.length === 0,
    universeDate: data.universeDate,
    requested: targets.length,
    completed,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  }

  const materialFailure = errors.length > 0 && (errors.length >= 5 || errors.length === targets.length)
  if (materialFailure) {
    await notifyOpsError({
      source: "scanner-universe",
      message: `${errors.length}/${targets.length} scanner targets failed`,
      metadata: {
        requested: targets.length,
        completed: completed.length,
        skipped: skipped.length,
        errors: errors.length,
        sample: errors.slice(0, 3).map((item) => `${item.ticker}:${item.error}`).join(" | ").slice(0, 500),
      },
    })
  }

  return summary
}
