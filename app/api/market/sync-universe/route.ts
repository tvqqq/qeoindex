import { NextResponse } from "next/server"

import { getScannerData } from "@/lib/scanner-data"
import { fetchDnseSessionHistory, type DnseSessionHistory } from "@/lib/dnse-market-runtime"
import { fetchYahooFiveMinuteSnapshot } from "@/lib/yahoo-history"
import { batchUpsertOrderbookSnapshotsToSupabase } from "@/lib/supabase/orderbook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const CONCURRENCY = 20
const MAX_TOTAL_DURATION_MS = 22_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms for ${label}`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

export async function GET(request: Request) {
  return handleSync(request)
}

export async function POST(request: Request) {
  return handleSync(request)
}

function isVietnamTradingWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0)

  const isWeekday = weekday !== "Sat" && weekday !== "Sun"
  // 09:00 to 15:15 ICT (covering morning, afternoon, and post-market closing sync)
  const isMarketHours = (hour >= 9 && hour < 15) || (hour === 15 && minute <= 15)
  return isWeekday && isMarketHours
}

async function handleSync(request: Request) {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const isForce = url.searchParams.get("force") === "1"

  if (!isVietnamTradingWindow() && !isForce) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Outside Vietnam trading window (09:00 - 15:15 weekdays). Pass ?force=1 to sync anyway.",
      currentTimeICT: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date()),
    })
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
    // Guard against total serverless function timeout
    if (Date.now() - startedAt > MAX_TOTAL_DURATION_MS) {
      break
    }

    const chunk = targetSymbols.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          // 1. Try DNSE OpenAPI session history with 2.5s timeout
          const history = await withTimeout(fetchDnseSessionHistory(symbol, new Date()), 2500, symbol)
          syncedHistories.push(history)
        } catch (dnseErr) {
          // 2. Fallback to Yahoo 5m intraday snapshot
          try {
            const yahooSnap = await withTimeout(fetchYahooFiveMinuteSnapshot(symbol, new Date()), 1500, `yahoo-${symbol}`)
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
