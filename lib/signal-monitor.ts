import { fetchDnseLiveSnapshot } from "@/lib/dnse-live"
import { getScannerData } from "@/lib/scanner-data"
import { createBuyRecommendation, createSignalEvent, getOpenRecommendations, closeRecommendation, updateRecommendationMonitor } from "@/lib/signal-data"
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
  buys?: Array<{ ticker: string; price: number; stopPrice: number | null; targetPrice: number | null; volumePace: number | null }>
  exits?: Array<{ ticker: string; price: number; returnPct: number; alphaPct: number | null; outcome: string; reason: string }>
  missingQuotes?: string[]
}

export async function runSignalMonitor({ force = false }: { force?: boolean } = {}): Promise<SignalMonitorSummary> {
  const session = marketSessionProgress()
  if (!session.active && !force) {
    return { ok: true, skipped: true, reason: "Outside HOSE monitoring window", session, engineVersion: SIGNAL_ENGINE_VERSION }
  }

  const [scanner, openRows] = await Promise.all([getScannerData(), getOpenRecommendations()])
  if (scanner.source !== "notion") throw new Error("Scanner is not reading live Notion data; fail-closed")

  const bullish = Object.values(scanner.latestScans).filter((scan) => scan.taBias === "Bullish" && scan.status === "Complete")
  const openByTicker = new Map(openRows.map((row) => [row.ticker, row]))
  const symbols = [...new Set([...bullish.map((row) => row.ticker), ...openRows.map((row) => row.ticker)])]
  if (!symbols.length) {
    return { ok: true, session, engineVersion: SIGNAL_ENGINE_VERSION, bullishCandidates: 0, openBefore: 0, openAfter: 0, monitored: [], buys: [], exits: [], missingQuotes: [] }
  }

  const live = await fetchDnseLiveSnapshot(symbols)
  const exits: NonNullable<SignalMonitorSummary["exits"]> = []
  const buys: NonNullable<SignalMonitorSummary["buys"]> = []
  const monitored: NonNullable<SignalMonitorSummary["monitored"]> = []
  const missingQuotes: string[] = []
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
    await createSignalEvent({
      type: decision.type,
      recommendationId: row.id,
      scan,
      quote,
      rule: decision.reason,
      relVolume: decision.volumePace,
      stopPrice: row.stopPrice,
      vnindex: live.vnindex,
      telegramSent: false,
    })
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
    const decision = evaluateBuy(scan, quote, quote.timestamp)
    if (!decision.signal) continue

    const recommendation = await createBuyRecommendation({ scan, quote, decision, vnindex: live.vnindex })
    await createSignalEvent({
      type: "BUY",
      recommendationId: recommendation.id,
      scan,
      quote,
      rule: decision.reason,
      relVolume: decision.volumePace,
      stopPrice: decision.stopPrice,
      vnindex: live.vnindex,
      telegramSent: false,
    })
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
    buys,
    exits,
    missingQuotes,
  }
}
