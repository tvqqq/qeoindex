import { isVietnamSecuritiesTradingDay } from "./vn-market-calendar.ts"

export const SIGNAL_ENGINE_VERSION = "workflow-v2.1"

export interface SignalDailyScan {
  ticker: string
  date: string
  price: number | null
  volume: number | null
  ma20: number | null
  ma50: number | null
  atr14: number | null
  relVolume: number | null
  taBias: string
  bullProbability: number | null
  baseProbability: number | null
  bearProbability: number | null
  support: string
  resistance: string
  status: string
  confidence?: string
}
export interface LiveQuote { ticker: string; price: number; totalVolume: number; timestamp: number }
export interface OpenRecommendationState {
  id: string
  ticker: string
  buyPrice: number
  stopPrice: number
  maxFavorablePct: number | null
  maxAdversePct: number | null
  buySignal?: string
  vnindexEntry?: number | null
}
export interface BuyDecision {
  signal: boolean
  reason: string
  stopPrice: number | null
  targetPrice: number | null
  riskPct: number | null
  volumePace: number | null
  diagnostics: string | null
}
export interface ExitDecision {
  signal: boolean
  type: "SELL" | "EXIT_FAIL" | null
  reason: string
  volumePace: number | null
  returnPct: number
  alphaPct: number | null
  maxFavorablePct: number
  maxAdversePct: number
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
export function parsePriceLevels(text: string) { return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => Number(token.replace(/,/g, ""))).filter((value) => Number.isFinite(value) && value > 0) }
function localClock(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) }
}
export function marketSessionProgress(timestampMs = Date.now()) {
  if (!isVietnamSecuritiesTradingDay(timestampMs)) return { active: false, progress: 0, label: "Closed" }
  const { weekday, hour, minute } = localClock(timestampMs)
  if (["Sat", "Sun"].includes(weekday)) return { active: false, progress: 0, label: "Closed" }
  const clock = hour * 60 + minute
  const morningStart = 9 * 60, atoEnd = 9 * 60 + 15, morningEnd = 11 * 60 + 30
  const afternoonStart = 13 * 60, continuousEnd = 14 * 60 + 30, afternoonEnd = 14 * 60 + 45
  const totalMinutes = (morningEnd - morningStart) + (afternoonEnd - afternoonStart)
  if (clock < morningStart || clock > afternoonEnd || (clock > morningEnd && clock < afternoonStart)) {
    return { active: false, progress: clock >= morningEnd && clock < afternoonStart ? (morningEnd - morningStart) / totalMinutes : 0, label: "Closed" }
  }
  const elapsed = clock <= morningEnd ? clock - morningStart : (morningEnd - morningStart) + (clock - afternoonStart)
  const label = clock <= atoEnd ? "ATO" : clock <= morningEnd ? "Morning" : clock <= continuousEnd ? "Afternoon" : "ATC"
  return { active: true, progress: clamp(elapsed / totalMinutes, 0.04, 1), label }
}

export function estimateVolumePace(scan: SignalDailyScan, currentVolume: number, timestampMs = Date.now(), fallbackBaseline: number | null = null) {
  const session = marketSessionProgress(timestampMs)
  if (!session.active) return null
  let baseline: number | null = null
  if (scan.volume && scan.volume > 0) {
    baseline = scan.relVolume && scan.relVolume > 0.05 ? scan.volume / scan.relVolume : scan.volume
  } else if (fallbackBaseline && fallbackBaseline > 0) {
    baseline = fallbackBaseline
  }
  if (!baseline || baseline <= 0) return null
  return currentVolume / Math.max(1, baseline * session.progress)
}
function nearestBelow(levels: number[], price: number) { return levels.filter((level) => level < price).sort((a, b) => b - a)[0] ?? null }
function nearestAbove(levels: number[], price: number) { return levels.filter((level) => level > price).sort((a, b) => a - b)[0] ?? null }
function pass(value: boolean) { return value ? "PASS" : "FAIL" }
function noBuy(reason: string, volumePace: number | null = null, diagnostics: string | null = null): BuyDecision {
  return { signal: false, reason, stopPrice: null, targetPrice: null, riskPct: null, volumePace, diagnostics }
}

export function evaluateBuy(scan: SignalDailyScan, quote: LiveQuote, timestampMs = Date.now(), fallbackVolumeBaseline: number | null = null): BuyDecision {
  if (scan.taBias !== "Bullish") return noBuy("Daily Bias không Bullish")
  if (scan.status !== "Complete") return noBuy("Daily scan chưa Complete")
  if (!scan.price || scan.price <= 0) return noBuy("Thiếu previous Daily close")
  if ((scan.bullProbability ?? 0) < 40) return noBuy("Bull probability < 40%")

  const price = quote.price
  const changePct = ((price - scan.price) / scan.price) * 100
  const pace = estimateVolumePace(scan, quote.totalVolume, timestampMs, fallbackVolumeBaseline)
  const aboveMa20 = scan.ma20 == null || price > scan.ma20
  const aboveMa50 = scan.ma50 == null || price > scan.ma50
  const atrDistance = scan.atr14 && scan.atr14 > 0 ? (price - scan.price) / scan.atr14 : 0
  const resistance = nearestAbove(parsePriceLevels(scan.resistance), scan.price)
  const breakout = resistance != null && resistance <= scan.price * 1.06 && price >= resistance * 1.001
  const momentum = price >= scan.price * 1.015
  const minMomentum = changePct >= 0.8
  const maxExtension = changePct <= 5.5
  const volumeGate = pace != null && pace >= 1.35
  const atrGate = !scan.atr14 || atrDistance <= 2.2
  const triggerGate = breakout || momentum
  const baselineSource = scan.volume && scan.volume > 0
    ? (scan.relVolume && scan.relVolume > 0.05 ? "rel-volume" : "previous-session")
    : fallbackVolumeBaseline && fallbackVolumeBaseline > 0 ? "avg20-fallback" : "unavailable"
  const diagnostics = [
    `change ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% ${pass(minMomentum)}`,
    `extension<=5.5% ${pass(maxExtension)}`,
    `MA20 ${scan.ma20 == null ? "N/A" : pass(aboveMa20)}`,
    `MA50 ${scan.ma50 == null ? "N/A" : pass(aboveMa50)}`,
    `volume ${pace == null ? "N/A" : pace.toFixed(2) + "x"} ${pass(volumeGate)} (${baselineSource})`,
    `ATR ${scan.atr14 ? atrDistance.toFixed(2) + " " + pass(atrGate) : "N/A"}`,
    `breakout ${pass(breakout)}`,
    `momentum1.5 ${pass(momentum)}`,
    `trigger ${pass(triggerGate)}`,
  ].join(" · ")
  const checks = [minMomentum, maxExtension, aboveMa20, aboveMa50, volumeGate, atrGate, triggerGate]
  if (!checks.every(Boolean)) {
    const why = [
      !minMomentum ? "momentum < +0.8%" : null,
      !maxExtension ? "giá đã tăng > +5.5%" : null,
      !aboveMa20 ? "dưới MA20" : null,
      !aboveMa50 ? "dưới MA50" : null,
      !volumeGate ? `volume pace ${pace == null ? "N/A" : pace.toFixed(2) + "x"} < 1.35x` : null,
      !atrGate ? `giá cách prior close ${atrDistance.toFixed(2)} ATR` : null,
      !triggerGate ? "chưa breakout/đủ momentum" : null,
    ].filter(Boolean).join("; ")
    return noBuy(why || "Chưa đủ BUY confirmation", pace, diagnostics)
  }

  const support = nearestBelow(parsePriceLevels(scan.support), price)
  const atrStop = scan.atr14 && scan.atr14 > 0 ? price - 1.5 * scan.atr14 : price * 0.96
  const structuralStop = support ? support - (scan.atr14 ?? price * 0.01) * 0.25 : price * 0.96
  let stopPrice = Math.max(atrStop, structuralStop, price * 0.93)
  stopPrice = Math.min(stopPrice, price * 0.98)
  const riskPct = ((price - stopPrice) / price) * 100
  const targetPrice = price + (price - stopPrice) * 2
  const trigger = breakout && resistance ? `breakout ${resistance.toFixed(2)}` : `momentum +${changePct.toFixed(2)}%`
  return {
    signal: true,
    reason: `BUY v2.1: Daily Bullish ${scan.bullProbability ?? "—"}/${scan.baseProbability ?? "—"}/${scan.bearProbability ?? "—"}; ${trigger}; volume pace ${pace?.toFixed(2)}x; giữ trên MA20/MA50; stop ${stopPrice.toFixed(2)} (${riskPct.toFixed(2)}%).`,
    stopPrice,
    targetPrice,
    riskPct,
    volumePace: pace,
    diagnostics,
  }
}

export function evaluateExit(open: OpenRecommendationState, scan: SignalDailyScan | undefined, quote: LiveQuote, timestampMs = Date.now(), vnindexNow: number | null = null): ExitDecision {
  const returnPct = ((quote.price - open.buyPrice) / open.buyPrice) * 100
  const maxFavorablePct = Math.max(open.maxFavorablePct ?? returnPct, returnPct)
  const maxAdversePct = Math.min(open.maxAdversePct ?? returnPct, returnPct)
  const pace = scan ? estimateVolumePace(scan, quote.totalVolume, timestampMs) : null
  const vnindexReturnPct = open.vnindexEntry && vnindexNow ? ((vnindexNow - open.vnindexEntry) / open.vnindexEntry) * 100 : null
  const alphaPct = vnindexReturnPct == null ? null : returnPct - vnindexReturnPct
  const holdMinutes = open.buySignal ? Math.max(0, (timestampMs - Date.parse(open.buySignal)) / 60_000) : 0
  const result = (signal: boolean, type: ExitDecision["type"], reason: string): ExitDecision => ({ signal, type, reason, volumePace: pace, returnPct, alphaPct, maxFavorablePct, maxAdversePct })

  if (quote.price <= open.stopPrice) return result(true, "EXIT_FAIL", `Hard stop: giá ${quote.price.toFixed(2)} <= stop ${open.stopPrice.toFixed(2)}.`)
  if (scan && scan.taBias !== "Bullish") return result(true, "EXIT_FAIL", `Daily thesis fail: Bias chuyển ${scan.taBias}; không còn điều kiện Bullish ban đầu.`)
  if (scan?.ma20 && quote.price < scan.ma20 && pace != null && pace >= 1.25) return result(true, "EXIT_FAIL", `Structural fail: giá mất MA20 ${scan.ma20.toFixed(2)} với volume pace ${pace.toFixed(2)}x.`)
  const support = scan ? nearestBelow(parsePriceLevels(scan.support), open.buyPrice) : null
  if (support && quote.price < support && pace != null && pace >= 1.2) return result(true, "EXIT_FAIL", `Acceptance risk dưới support ${support.toFixed(2)} với volume pace ${pace.toFixed(2)}x.`)

  const givebackPct = maxFavorablePct - returnPct
  if (maxFavorablePct >= 5 && returnPct > 0.5 && givebackPct >= 2.2) {
    return result(true, "SELL", `Profit protection: MFE +${maxFavorablePct.toFixed(2)}%, đã give-back ${givebackPct.toFixed(2)}%; khóa lợi nhuận thay vì trả lại alpha.`)
  }
  if (holdMinutes >= 60 && alphaPct != null && alphaPct <= -2.5 && returnPct < 1) {
    return result(true, "EXIT_FAIL", `Relative-strength fail: alpha ${alphaPct.toFixed(2)}% so với VNINDEX sau ${Math.round(holdMinutes)} phút; vốn đang nằm ở mã underperform.`)
  }
  return result(false, null, `Open thesis vẫn hợp lệ${alphaPct == null ? "" : `; alpha ${alphaPct >= 0 ? "+" : ""}${alphaPct.toFixed(2)}% vs VNINDEX`}`)
}
