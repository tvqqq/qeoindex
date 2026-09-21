import { vietnamDateKey } from "@/modules/market/providers/dnse/history"
import { fetchDailyMarketHistory } from "@/modules/market/history/index"
import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { getScannerDataFresh, invalidateScannerDataCache, rowToPreviousResult, writeDailyScan } from "@/modules/signals/scanner/data"
import { scannerHistoryPolicy, shouldSkipSameDateScan, type ScannerHistoryStatus } from "@/modules/signals/scanner/policy"
import { scanWyckoff, type WyckoffScanResult } from "@/modules/wyckoff/engine"
import { UNIVERSE_SIZE } from "@/modules/wyckoff/universe"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ScannerRunTarget {
  ticker: string
  rank: number
  previousDate: string | null
  previousStatus: string | null
  previousResult: WyckoffScanResult | null
}

export interface ScannerRunPlan {
  universeDate: string
  targets: ScannerRunTarget[]
}

export interface ScannerBatchSummary {
  requested: number
  completed: Array<{ ticker: string; provider: string; date: string; status: ScannerHistoryStatus; completedDailyBars: number }>
  skipped: string[]
  errors: Array<{ ticker: string; error: string }>
}

export interface ScannerRunSummary extends ScannerBatchSummary {
  ok: boolean
  universeDate: string
  generatedAt: string
}

export async function prepareScannerRun({
  limit = UNIVERSE_SIZE,
  offset = 0,
}: {
  limit?: number
  offset?: number
} = {}): Promise<ScannerRunPlan> {
  // Freeze membership + previous-scan evidence once per logical run.
  // Workflow batches must not re-read latest Notion scan pages after earlier
  // batches have already written today's rows, otherwise later batches lose
  // their previous-session comparison baseline.
  const data = await getScannerDataFresh()
  const safeLimit = Math.max(1, Math.min(UNIVERSE_SIZE, limit))
  const safeOffset = Math.max(0, offset)

  return {
    universeDate: data.universeDate,
    targets: data.universe.slice(safeOffset, safeOffset + safeLimit).map((stock) => {
      const previousRow = data.latestScans[stock.ticker]
      return {
        ticker: stock.ticker,
        rank: stock.rank,
        previousDate: previousRow?.date ?? null,
        previousStatus: previousRow?.status ?? null,
        previousResult: rowToPreviousResult(previousRow),
      }
    }),
  }
}

export async function runScannerBatch(
  plan: ScannerRunPlan,
  {
    offset = 0,
    limit = plan.targets.length,
  }: {
    offset?: number
    limit?: number
  } = {},
): Promise<ScannerBatchSummary> {
  const safeOffset = Math.max(0, offset)
  const safeLimit = Math.max(1, limit)
  const targets = plan.targets.slice(safeOffset, safeOffset + safeLimit)

  const completed: ScannerBatchSummary["completed"] = []
  const skipped: string[] = []
  const errors: ScannerBatchSummary["errors"] = []

  for (let start = 0; start < targets.length; start += 5) {
    const batch = targets.slice(start, start + 5)
    const fetched = await Promise.allSettled(batch.map(async (target) => {
      const historical = await fetchDailyMarketHistory(target.ticker)
      const bars = historical.bars
      const historyPolicy = scannerHistoryPolicy(bars.length)
      const scanDate = vietnamDateKey(bars.at(-1)!.time * 1000)
      if (
        target.previousDate === scanDate
        && shouldSkipSameDateScan(target.previousStatus ?? undefined, historyPolicy.status)
      ) {
        return {
          target,
          scanDate,
          provider: historical.provider,
          historyPolicy,
          completedDailyBars: bars.length,
          skip: true as const,
          result: null,
        }
      }

      const result = scanWyckoff(bars, target.previousResult)
      if (historyPolicy.forceLowConfidence) result.confidence = "LOW"
      return {
        target,
        scanDate,
        provider: historical.provider,
        historyPolicy,
        completedDailyBars: bars.length,
        skip: false as const,
        result,
      }
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
        await writeDailyScan(
          ticker,
          outcome.value.target.rank,
          outcome.value.scanDate,
          outcome.value.result,
          outcome.value.provider,
          outcome.value.historyPolicy.status,
        )
        completed.push({
          ticker,
          provider: outcome.value.provider,
          date: outcome.value.scanDate,
          status: outcome.value.historyPolicy.status,
          completedDailyBars: outcome.value.completedDailyBars,
        })
      } catch (error) {
        errors.push({ ticker, error: error instanceof Error ? error.message : String(error) })
      }
      await sleep(380)
    }
  }

  return {
    requested: targets.length,
    completed,
    skipped,
    errors,
  }
}

export async function finalizeScannerRun(
  plan: ScannerRunPlan,
  batches: ScannerBatchSummary[],
): Promise<ScannerRunSummary> {
  const requested = batches.reduce((sum, batch) => sum + batch.requested, 0)
  if (requested !== plan.targets.length) {
    throw new Error(`Scanner batch coverage mismatch: ${requested}/${plan.targets.length} targets processed`)
  }

  const completed = batches.flatMap((batch) => batch.completed)
  const skipped = batches.flatMap((batch) => batch.skipped)
  const errors = batches.flatMap((batch) => batch.errors)

  // One invalidation per logical run avoids cache churn while keeping batch
  // retries idempotent and independent from UI cache availability.
  if (completed.length > 0) await invalidateScannerDataCache()

  const summary: ScannerRunSummary = {
    ok: errors.length === 0,
    universeDate: plan.universeDate,
    requested,
    completed,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  }

  const materialFailure = errors.length > 0 && (errors.length >= 5 || errors.length === requested)
  if (materialFailure) {
    await notifyOpsError({
      source: "scanner-universe",
      message: `${errors.length}/${requested} scanner targets failed`,
      metadata: {
        requested,
        completed: completed.length,
        skipped: skipped.length,
        errors: errors.length,
        sample: errors.slice(0, 3).map((item) => `${item.ticker}:${item.error}`).join(" | ").slice(0, 500),
      },
    })
  }

  return summary
}

export async function runScannerUniverse({
  limit = UNIVERSE_SIZE,
  offset = 0,
}: {
  limit?: number
  offset?: number
} = {}): Promise<ScannerRunSummary> {
  const plan = await prepareScannerRun({ limit, offset })
  const batch = await runScannerBatch(plan)
  return finalizeScannerRun(plan, [batch])
}
