import { NextRequest, NextResponse } from "next/server"
import { fetchDailyOhlcv, dnseProviderHealth, vietnamDateKey } from "@/lib/dnse-history"
import { getScannerData, rowToPreviousResult, writeDailyScan } from "@/lib/scanner-data"
import { scanWyckoff } from "@/lib/wyckoff-engine"

export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorized(request: NextRequest) {
  const configured = [process.env.SCANNER_RUN_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (!configured.length) return process.env.NODE_ENV !== "production"
  const header = request.headers.get("authorization") ?? ""
  return configured.some((secret) => header === `Bearer ${secret}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Scanner authorization is not configured or invalid." }, { status: 401 })
  }

  const health = dnseProviderHealth()
  if (!health.configured) {
    return NextResponse.json({ ok: false, error: health.message }, { status: 503 })
  }

  const data = await getScannerData()
  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 50)))
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))
  const targets = data.universe.slice(offset, offset + limit)

  const completed: string[] = []
  const skipped: string[] = []
  const errors: Array<{ ticker: string; error: string }> = []

  for (let start = 0; start < targets.length; start += 5) {
    const batch = targets.slice(start, start + 5)
    const fetched = await Promise.allSettled(batch.map(async (stock) => {
      const bars = await fetchDailyOhlcv(stock.ticker)
      if (bars.length < 200) throw new Error(`Only ${bars.length} completed Daily bars; need >=200 for MA200 baseline`)
      const scanDate = vietnamDateKey(bars.at(-1)!.time * 1000)
      const previousRow = data.latestScans[stock.ticker]
      if (previousRow?.date === scanDate && previousRow.status === "Complete") {
        return { stock, scanDate, skip: true as const, result: null }
      }
      const result = scanWyckoff(bars, rowToPreviousResult(previousRow))
      return { stock, scanDate, skip: false as const, result }
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
        await writeDailyScan(ticker, outcome.value.stock.rank, outcome.value.scanDate, outcome.value.result)
        completed.push(ticker)
      } catch (error) {
        errors.push({ ticker, error: error instanceof Error ? error.message : String(error) })
      }
      // Notion has request-rate limits; keep writes intentionally paced.
      await sleep(380)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    universeDate: data.universeDate,
    requested: targets.length,
    completed,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  }, { status: errors.length === targets.length && targets.length > 0 ? 502 : 200 })
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
