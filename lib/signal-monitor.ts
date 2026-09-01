import { fetchDnseLiveSnapshot } from "@/lib/dnse-live"
import { fetchDailyMarketHistory } from "@/lib/market-history"
import { getScannerDataFresh, type DailyScanRow } from "@/lib/scanner-data"
import { createBuyRecommendation, createSignalEvent, getOpenRecommendationsFresh, closeRecommendation, updateRecommendationMonitor } from "@/lib/signal-data"
import { evaluateBuy, evaluateExit, marketSessionProgress, SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"

export interface SignalMonitorSummary {
  ok: boolean
  skipped?: boolean
  reason?: string
  engineVersion: string
  session: ReturnType<typeof marketSessionProgress>
  provider?: string
  providerDetail?: string
  vnindex?: number | null
  bullishCandidates?: number
  openBefore?: number
  openAfter?: number
  quotesReceived?: number
  monitored?: Array<{ ticker: string; price: number; returnPct: number; alphaPct: number | null; volumePace: number | null }>
  candidates?: Array<{ ticker: string; price: number; signal: boolean; reason: string; diagnostics: string | null; volumePace: number | null; fallbackVolumeBaseline: number | null }>
  buys?: Array<{ ticker: string; price: number; stopPrice: number | null; targetPrice: number | null; volumePace: number | null }>
  exits?: Array<{ ticker: string; price: number; returnPct: number; alphaPct: number | null; outcome: string; reason: string }>
  missingQuotes?: string[]
  diagnosticWriteErrors?: Array<{ ticker: string; error: string }>
}

function vietnamDateKey(timestampMs: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampMs))
}

async function averageVolume20Fallback(scan: DailyScanRow): Promise<number | null> {
  if (scan.volume && scan.volume > 0) return null
  try {
    const history = await fetchDailyMarketHistory(scan.ticker)
    const eligible = history.bars
      .filter((bar) => vietnamDateKey(bar.time * 1000) <= scan.date && bar.volume > 0)
      .slice(-20)
      .map((bar) => bar.volume)
    if (!eligible.length) return null
    return eligible.reduce((sum, volume) => sum + volume, 0) / eligible.length
  } catch {
    return null
  }
}

export async function runSignalMonitor({ force = false }: { force?: boolean } = {}): Promise<SignalMonitorSummary> {
  const session = marketSessionProgress()
  if (!session.active && !force) {
    return { ok: true, skipped: true, reason: "Outside HOSE monitoring window", session, engineVersion: SIGNAL_ENGINE_VERSION }
  }

  // Operational decisions intentionally bypass all UI read-model caches and read the canonical Supabase scanner source.
  const [scanner, openRows] = await Promise.all([getScannerDataFresh(), getOpenRecommendationsFresh()])

  const bullish = Object.values(scanner.latestScans).filter((scan) => scan.taBias === "Bullish" && scan.status === "Complete")
  const openByTicker = new Map(openRows.map((row) => [row.ticker, row]))
  const symbols = [...new Set([...bullish.map((row) => row.ticker), ...openRows.map((row) => row.ticker)])]
  if (!symbols.length) {
    return { ok: true, session, engineVersion: SIGNAL_ENGINE_VERSION, bullishCandidates: 0, openBefore: 0, openAfter: 0, monitored: [], candidates: [], buys: [], exits: [], missingQuotes: [], diagnosticWriteErrors: [] }
  }

  const buyCandidates = bullish.filter((scan) => !openByTicker.has(scan.ticker))
  const [live, fallbackPairs] = await Promise.all([
    fetchDnseLiveSnapshot(symbols),
    Promise.all(buyCandidates.map(async (scan) => [scan.ticker, await averageVolume20Fallback(scan)] as const)),
  ])
  const fallbackBaselines = new Map(fallbackPairs)
  const exits: NonNullable<SignalMonitorSummary["exits"]> = []
  const buys: NonNullable<SignalMonitorSummary["buys"]> = []
  const candidates: NonNullable<SignalMonitorSummary["candidates"]> = []
  const monitored: NonNullable<SignalMonitorSummary["monitored"]> = []
  const missingQuotes: string[] = []
  const diagnosticWriteErrors: NonNullable<SignalMonitorSummary["diagnosticWriteErrors"]> = []
  const exitedTickers = new Set<string>()

  for (const row of openRows) {
    const quote = live.quotes[row.ticker]
    if (!quote) {
      missingQuotes.push(row.ticker)
      continue
    }
    const scan = scanner.latestScans[row.ticker]
    const decision = evaluateExit(row, scan, quote, quote.timestamp, live.vnindex)
    if (!decision.signal || !decision.type) {
      await updateRecommendationMonitor(row, quote, decision)
      monitored.push({ ticker: row.ticker, price: quote.price, returnPct: decision.returnPct, alphaPct: decision.alphaPct, volumePace: decision.volumePace })
      continue
    }

    const close = await closeRecommendation(row, quote, decision, live.vnindex)
    await createSignalEvent({ type: decision.type, recommendationId: row.id, scan, quote, rule: decision.reason, relVolume: decision.volumePace, stopPrice: row.stopPrice, vnindex: live.vnindex })
    exits.push({ ticker: row.ticker, price: quote.price, returnPct: decision.returnPct, alphaPct: decision.alphaPct, outcome: close.outcome, reason: decision.reason })
    exitedTickers.add(row.ticker)
  }

  for (const scan of bullish) {
    if (openByTicker.has(scan.ticker) || exitedTickers.has(scan.ticker)) continue
    const quote = live.quotes[scan.ticker]
    if (!quote) {
      if (!missingQuotes.includes(scan.ticker)) missingQuotes.push(scan.ticker)
      continue
    }
    const fallbackVolumeBaseline = fallbackBaselines.get(scan.ticker) ?? null
    const decision = evaluateBuy(scan, quote, quote.timestamp, fallbackVolumeBaseline)
    candidates.push({ ticker: scan.ticker, price: quote.price, signal: decision.signal, reason: decision.reason, diagnostics: decision.diagnostics, volumePace: decision.volumePace, fallbackVolumeBaseline })

    if (!decision.signal) {
      try {
        await createSignalEvent({
          type: "WATCH",
          scan,
          quote,
          rule: `${decision.reason}${decision.diagnostics ? ` | ${decision.diagnostics}` : ""}`,
          relVolume: decision.volumePace,
          stopPrice: null,
          vnindex: live.vnindex,
        })
      } catch (error) {
        diagnosticWriteErrors.push({ ticker: scan.ticker, error: error instanceof Error ? error.message : String(error) })
      }
      continue
    }

    const recommendation = await createBuyRecommendation({ scan, quote, decision, vnindex: live.vnindex })
    await createSignalEvent({ type: "BUY", recommendationId: recommendation.id, scan, quote, rule: decision.reason, relVolume: decision.volumePace, stopPrice: decision.stopPrice, vnindex: live.vnindex })
    buys.push({ ticker: scan.ticker, price: quote.price, stopPrice: decision.stopPrice, targetPrice: decision.targetPrice, volumePace: decision.volumePace })
  }

  return {
    ok: true,
    engineVersion: SIGNAL_ENGINE_VERSION,
    session,
    provider: live.provider,
    providerDetail: live.detail,
    vnindex: live.vnindex,
    bullishCandidates: bullish.length,
    openBefore: openRows.length,
    openAfter: openRows.length - exits.length + buys.length,
    quotesReceived: Object.keys(live.quotes).length,
    monitored,
    candidates,
    buys,
    exits,
    missingQuotes,
    diagnosticWriteErrors,
  }
}
