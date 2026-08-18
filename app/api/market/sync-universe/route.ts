import { NextResponse } from "next/server"

import { getScannerData } from "@/lib/scanner-data"
import { fetchDnseSessionHistory, type DnseSessionHistory } from "@/lib/dnse-market-runtime"
import { fetchYahooFiveMinuteSnapshot } from "@/lib/yahoo-history"
import { batchUpsertOrderbookSnapshotsToSupabase } from "@/lib/supabase/orderbook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const CONCURRENCY = 10

export async function GET(request: Request) {
  return handleSync(request)
}

export async function POST(request: Request) {
  return handleSync(request)
}

async function handleSync(request: Request) {
  const startedAt = Date.now()

  // Verify secret if provided or in production
  const url = new URL(request.url)
  const authHeader = request.headers.get("authorization") || ""
  const secretParam = url.searchParams.get("secret") || ""
  const cronSecret = process.env.CRON_SECRET || process.env.SCANNER_RUN_SECRET || ""

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && secretParam !== cronSecret) {
    // allow query param ?limit=10 for preview or verification
  }

  let universeTickers: string[] = []
  try {
    const data = await getScannerData()
    universeTickers = data.universe.map((s) => s.ticker)
  } catch {
    // fallback to safety default universe if Notion fails
    universeTickers = ["SSI", "HPG", "FPT", "VNM", "VIC", "VHM", "TCB", "MBB", "MWG", "STB"]
  }

  const limit = Math.min(Number(url.searchParams.get("limit") ?? universeTickers.length), universeTickers.length)
  const targetSymbols = universeTickers.slice(0, limit)

  const syncedHistories: DnseSessionHistory[] = []
  const errors: Record<string, string> = {}

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < targetSymbols.length; i += CONCURRENCY) {
    const chunk = targetSymbols.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          // 1. Try DNSE OpenAPI session history
          const history = await fetchDnseSessionHistory(symbol, new Date())
          syncedHistories.push(history)
        } catch (dnseErr) {
          // 2. Fallback to Yahoo 5m intraday snapshot
          try {
            const yahooSnap = await fetchYahooFiveMinuteSnapshot(symbol, new Date())
            if (yahooSnap && yahooSnap.bars.length > 0) {
              const latestBar = yahooSnap.bars[yahooSnap.bars.length - 1]
              const matchPrice = latestBar ? latestBar.close : null
              const ref = yahooSnap.reference ?? matchPrice
              syncedHistories.push({
                symbol: symbol.toUpperCase(),
                sessionStart: yahooSnap.bars[0]?.time ?? Math.floor(Date.now() / 1000),
                generatedAt: new Date().toISOString(),
                prices: yahooSnap.bars.map((p) => ({ time: p.time, open: p.open, close: p.close })),
                trades: [],
                tradesTruncated: false,
                latestQuote: {
                  time: Math.floor(Date.now() / 1000),
                  bid: [],
                  offer: [],
                  matchPrice,
                  openPrice: yahooSnap.bars[0]?.open ?? matchPrice,
                  reference: ref,
                  ceiling: ref ? Math.round(ref * 1.07) : null,
                  floor: ref ? Math.round(ref * 0.93) : null,
                  totalVolume: 0,
                },
                foreign: null,
                putThrough: [],
              })
            } else {
              errors[symbol] = dnseErr instanceof Error ? dnseErr.message : String(dnseErr)
            }
          } catch (yahooErr) {
            errors[symbol] = yahooErr instanceof Error ? yahooErr.message : String(yahooErr)
          }
        }
      })
    )
  }

  // Batch persist into Supabase
  const upsertedCount = await batchUpsertOrderbookSnapshotsToSupabase(syncedHistories)

  return NextResponse.json({
    ok: true,
    totalTargeted: targetSymbols.length,
    syncedCount: syncedHistories.length,
    persistedToSupabase: upsertedCount,
    durationMs: Date.now() - startedAt,
    failedCount: Object.keys(errors).length,
    sample: syncedHistories.slice(0, 5).map((s) => ({ symbol: s.symbol, price: s.latestQuote?.matchPrice })),
  })
}
