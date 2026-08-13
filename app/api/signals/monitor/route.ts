import { NextRequest, NextResponse } from "next/server"

import { fetchDnseLiveSnapshot } from "@/lib/dnse-live"
import { getScannerData } from "@/lib/scanner-data"
import { createBuyRecommendation, createSignalEvent, getOpenRecommendations, closeRecommendation, setRecommendationTelegramSent, updateRecommendationMonitor } from "@/lib/signal-data"
import { evaluateBuy, evaluateExit, marketSessionProgress, SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"
import { sendTelegramMessage, telegramConfigured } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(request: NextRequest) {
  const candidates = [process.env.SIGNAL_MONITOR_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (!candidates.length) return false
  const auth = request.headers.get("authorization") ?? ""
  return candidates.some((secret) => auth === `Bearer ${secret}`)
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const session = marketSessionProgress()
  const force = request.nextUrl.searchParams.get("force") === "1"
  if (!session.active && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Outside HOSE monitoring window", session, engineVersion: SIGNAL_ENGINE_VERSION })
  }

  try {
    const [scanner, openRows] = await Promise.all([getScannerData(), getOpenRecommendations()])
    if (scanner.source !== "notion") return NextResponse.json({ ok: false, error: "Scanner is not reading live Notion data; fail-closed" }, { status: 503 })

    const bullish = Object.values(scanner.latestScans).filter((scan) => scan.taBias === "Bullish" && scan.status === "Complete")
    const openByTicker = new Map(openRows.map((row) => [row.ticker, row]))
    const symbols = [...new Set([...bullish.map((row) => row.ticker), ...openRows.map((row) => row.ticker)])]
    if (!symbols.length) return NextResponse.json({ ok: true, session, candidates: 0, open: 0, message: "No Bullish Daily candidates or open recommendations" })

    const live = await fetchDnseLiveSnapshot(symbols)
    const exits: any[] = []
    const buys: any[] = []
    const monitored: any[] = []
    const missingQuotes: string[] = []
    const exitedTickers = new Set<string>()

    for (const row of openRows) {
      const quote = live.quotes[row.ticker]
      if (!quote) {
        missingQuotes.push(row.ticker)
        continue
      }
      const scan = scanner.latestScans[row.ticker]
      const decision = evaluateExit(row, scan, quote)
      if (!decision.signal || !decision.type) {
        await updateRecommendationMonitor(row, quote, decision)
        monitored.push({ ticker: row.ticker, price: quote.price, returnPct: decision.returnPct, volumePace: decision.volumePace })
        continue
      }

      const close = await closeRecommendation(row, quote, decision, live.vnindex)
      const message = [
        `StockOS ${decision.type} · ${row.ticker}`,
        `Giá: ${money(quote.price)} | Entry: ${money(row.buyPrice)} | Return: ${decision.returnPct >= 0 ? "+" : ""}${decision.returnPct.toFixed(2)}%`,
        `Stop: ${money(row.stopPrice)} | VNINDEX: ${money(live.vnindex)}`,
        `Lý do: ${decision.reason}`,
        `Engine: ${SIGNAL_ENGINE_VERSION}`,
      ].join("\n")
      const telegram = await sendTelegramMessage(message)
      await createSignalEvent({
        type: decision.type,
        recommendationId: row.id,
        scan,
        quote,
        rule: decision.reason,
        relVolume: decision.volumePace,
        stopPrice: row.stopPrice,
        vnindex: live.vnindex,
        telegramSent: telegram.sent,
      })
      if (telegram.sent) await setRecommendationTelegramSent(row.id, true)
      exits.push({ ticker: row.ticker, price: quote.price, ...close, telegram: telegram.detail, reason: decision.reason })
      exitedTickers.add(row.ticker)
    }

    for (const scan of bullish) {
      if (openByTicker.has(scan.ticker) || exitedTickers.has(scan.ticker)) continue
      const quote = live.quotes[scan.ticker]
      if (!quote) {
        if (!missingQuotes.includes(scan.ticker)) missingQuotes.push(scan.ticker)
        continue
      }
      const decision = evaluateBuy(scan, quote)
      if (!decision.signal) continue

      const recommendation = await createBuyRecommendation({ scan, quote, decision, vnindex: live.vnindex })
      const message = [
        `StockOS BUY · ${scan.ticker}`,
        `Giá: ${money(quote.price)} | Stop: ${money(decision.stopPrice)} | Risk: ${decision.riskPct?.toFixed(2) ?? "—"}%`,
        `Target tham chiếu 2R: ${money(decision.targetPrice)} | Volume pace: ${decision.volumePace?.toFixed(2) ?? "—"}x`,
        `Daily scan: ${scan.date} | Bias: ${scan.taBias} | Bull/Base/Bear: ${scan.bullProbability}/${scan.baseProbability}/${scan.bearProbability}`,
        `Lý do: ${decision.reason}`,
        `Engine: ${SIGNAL_ENGINE_VERSION}`,
      ].join("\n")
      const telegram = await sendTelegramMessage(message)
      await createSignalEvent({
        type: "BUY",
        recommendationId: recommendation.id,
        scan,
        quote,
        rule: decision.reason,
        relVolume: decision.volumePace,
        stopPrice: decision.stopPrice,
        vnindex: live.vnindex,
        telegramSent: telegram.sent,
      })
      if (telegram.sent) await setRecommendationTelegramSent(recommendation.id, true)
      buys.push({ ticker: scan.ticker, price: quote.price, stopPrice: decision.stopPrice, targetPrice: decision.targetPrice, volumePace: decision.volumePace, telegram: telegram.detail })
    }

    return NextResponse.json({
      ok: true,
      engineVersion: SIGNAL_ENGINE_VERSION,
      session,
      provider: live.provider,
      providerDetail: live.detail,
      telegramConfigured: telegramConfigured(),
      vnindex: live.vnindex,
      bullishCandidates: bullish.length,
      openBefore: openRows.length,
      quotesReceived: Object.keys(live.quotes).length,
      monitored,
      buys,
      exits,
      missingQuotes,
    }, { status: missingQuotes.length ? 207 : 200 })
  } catch (error) {
    console.error("Intraday signal monitor failed", error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), engineVersion: SIGNAL_ENGINE_VERSION }, { status: 500 })
  }
}
