import { NextResponse } from "next/server"
import { vietnamDateKey } from "@/lib/dnse-history"
import { fetchDailyMarketHistory } from "@/lib/market-history"
import { getScannerData, writeDailyScan, type DailyScanStatus } from "@/lib/scanner-data"
import { scanWyckoff } from "@/lib/wyckoff-engine"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const TARGET_DATE = "2026-08-12"
const AS_OF = new Date("2026-08-13T10:00:00+07:00")
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET() {
  const data = await getScannerData()
  const completed: Array<{ ticker: string; provider: string; status: DailyScanStatus; bars: number }> = []
  const skipped: string[] = []
  const errors: Array<{ ticker: string; error: string }> = []

  for (let start = 0; start < data.universe.length; start += 5) {
    const batch = data.universe.slice(start, start + 5)
    const fetched = await Promise.allSettled(batch.map(async (stock) => {
      const existing = data.latestScans[stock.ticker]
      if (existing?.date === TARGET_DATE && ["Complete", "Incomplete"].includes(existing.status)) {
        return { stock, skip: true as const, historical: null, result: null, status: existing.status as DailyScanStatus }
      }

      const historical = await fetchDailyMarketHistory(stock.ticker, AS_OF)
      const bars = historical.bars.filter((bar) => vietnamDateKey(bar.time * 1000) <= TARGET_DATE)
      if (bars.length < 60) throw new Error(`Only ${bars.length} Daily bars available; need >=60 for Wyckoff screening`)
      const latestDate = vietnamDateKey(bars.at(-1)!.time * 1000)
      if (latestDate !== TARGET_DATE) throw new Error(`Latest completed bar is ${latestDate}, expected ${TARGET_DATE}`)

      const status: DailyScanStatus = bars.length >= 200 ? "Complete" : "Incomplete"
      const result = scanWyckoff(bars, null)
      result.whatChanged = `INIT snapshot ${TARGET_DATE}. ${result.whatChanged}`
      if (status === "Incomplete") {
        result.confidence = "LOW"
        result.whatChanged = `INIT snapshot ${TARGET_DATE}; chỉ có ${bars.length} Daily bars nên MA200 có thể chưa khả dụng. ${result.whatChanged}`
      }
      return { stock, skip: false as const, historical, result, status }
    }))

    for (let i = 0; i < fetched.length; i += 1) {
      const outcome = fetched[i]
      const ticker = batch[i].ticker
      if (outcome.status === "rejected") {
        errors.push({ ticker, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) })
        continue
      }
      if (outcome.value.skip || !outcome.value.historical || !outcome.value.result) {
        skipped.push(ticker)
        continue
      }
      try {
        await writeDailyScan(
          ticker,
          outcome.value.stock.rank,
          TARGET_DATE,
          outcome.value.result,
          outcome.value.historical.provider,
          outcome.value.status,
        )
        completed.push({
          ticker,
          provider: outcome.value.historical.provider,
          status: outcome.value.status,
          bars: outcome.value.historical.bars.filter((bar) => vietnamDateKey(bar.time * 1000) <= TARGET_DATE).length,
        })
      } catch (error) {
        errors.push({ ticker, error: error instanceof Error ? error.message : String(error) })
      }
      await sleep(420)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    targetDate: TARGET_DATE,
    universe: data.universe.length,
    completed,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  }, { status: errors.length ? 207 : 200 })
}
