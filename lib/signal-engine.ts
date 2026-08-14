export const SIGNAL_ENGINE_VERSION = "intraday-v1.0"

// Infrastructure-free deterministic contract shared by the Next.js UI and server jobs.
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
export interface OpenRecommendationState { id: string; ticker: string; buyPrice: number; stopPrice: number; maxFavorablePct: number | null; maxAdversePct: number | null }
export interface BuyDecision { signal: boolean; reason: string; stopPrice: number | null; targetPrice: number | null; riskPct: number | null; volumePace: number | null }
export interface ExitDecision { signal: boolean; type: "SELL" | "EXIT_FAIL" | null; reason: string; volumePace: number | null; returnPct: number; maxFavorablePct: number; maxAdversePct: number }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
export function parsePriceLevels(text: string) { return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => Number(token.replace(/,/g, ""))).filter((value) => Number.isFinite(value) && value > 0) }
function localClock(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) }
}
export function marketSessionProgress(timestampMs = Date.now()) {
  const { weekday, hour, minute } = localClock(timestampMs)
  if (["Sat", "Sun"].includes(weekday)) return { active: false, progress: 0, label: "Closed" }
  const clock = hour * 60 + minute, morningStart = 9 * 60, morningEnd = 11 * 60 + 30, afternoonStart = 13 * 60, afternoonEnd = 14 * 60 + 45
  const totalMinutes = (morningEnd - morningStart) + (afternoonEnd - afternoonStart)
  if (clock < morningStart || clock > afternoonEnd || (clock > morningEnd && clock < afternoonStart)) return { active: false, progress: clock >= morningEnd && clock < afternoonStart ? (morningEnd - morningStart) / totalMinutes : 0, label: "Closed" }
  const elapsed = clock <= morningEnd ? clock - morningStart : (morningEnd - morningStart) + (clock - afternoonStart)
  return { active: true, progress: clamp(elapsed / totalMinutes, 0.04, 1), label: clock <= morningEnd ? "Morning" : "Afternoon" }
}
export function estimateVolumePace(scan: SignalDailyScan, currentVolume: number, timestampMs = Date.now()) {
  const session = marketSessionProgress(timestampMs)
  if (!session.active || !scan.volume || scan.volume <= 0) return null
  const baseline = scan.relVolume && scan.relVolume > 0.05 ? scan.volume / scan.relVolume : scan.volume
  return currentVolume / Math.max(1, baseline * session.progress)
}
function nearestBelow(levels: number[], price: number) { return levels.filter((level) => level < price).sort((a, b) => b - a)[0] ?? null }
function nearestAbove(levels: number[], price: number) { return levels.filter((level) => level > price).sort((a, b) => a - b)[0] ?? null }
export function evaluateBuy(scan: SignalDailyScan, quote: LiveQuote, timestampMs = Date.now()): BuyDecision {
  if (scan.taBias !== "Bullish") return { signal: false, reason: "Daily Bias không Bullish", stopPrice: null, targetPrice: null, riskPct: null, volumePace: null }
  if (scan.status !== "Complete") return { signal: false, reason: "Daily scan chưa Complete", stopPrice: null, targetPrice: null, riskPct: null, volumePace: null }
  if (!scan.price || scan.price <= 0) return { signal: false, reason: "Thiếu previous Daily close", stopPrice: null, targetPrice: null, riskPct: null, volumePace: null }
  if ((scan.bullProbability ?? 0) < 40) return { signal: false, reason: "Bull probability < 40%", stopPrice: null, targetPrice: null, riskPct: null, volumePace: null }
  const price = quote.price, changePct = ((price - scan.price) / scan.price) * 100, pace = estimateVolumePace(scan, quote.totalVolume, timestampMs)
  const aboveMa20 = scan.ma20 == null || price > scan.ma20, aboveMa50 = scan.ma50 == null || price > scan.ma50
  const atrDistance = scan.atr14 && scan.atr14 > 0 ? (price - scan.price) / scan.atr14 : 0
  const resistance = nearestAbove(parsePriceLevels(scan.resistance), scan.price)
  const breakout = resistance != null && resistance <= scan.price * 1.06 && price >= resistance * 1.001, momentum = price >= scan.price * 1.015
  const checks = [changePct >= 0.8, changePct <= 5.5, aboveMa20, aboveMa50, pace != null && pace >= 1.35, !scan.atr14 || atrDistance <= 2.2, breakout || momentum]
  if (!checks.every(Boolean)) {
    const why = [changePct < 0.8 ? "momentum < +0.8%" : null, changePct > 5.5 ? "giá đã tăng > +5.5%" : null, !aboveMa20 ? "dưới MA20" : null, !aboveMa50 ? "dưới MA50" : null, pace == null || pace < 1.35 ? `volume pace ${pace == null ? "N/A" : pace.toFixed(2) + "x"} < 1.35x` : null, scan.atr14 && atrDistance > 2.2 ? `giá cách prior close ${atrDistance.toFixed(2)} ATR` : null, !breakout && !momentum ? "chưa breakout/đủ momentum" : null].filter(Boolean).join("; ")
    return { signal: false, reason: why || "Chưa đủ BUY confirmation", stopPrice: null, targetPrice: null, riskPct: null, volumePace: pace }
  }
  const support = nearestBelow(parsePriceLevels(scan.support), price), atrStop = scan.atr14 && scan.atr14 > 0 ? price - 1.5 * scan.atr14 : price * 0.96, structuralStop = support ? support - (scan.atr14 ?? price * 0.01) * 0.25 : price * 0.96
  let stopPrice = Math.max(atrStop, structuralStop, price * 0.93); stopPrice = Math.min(stopPrice, price * 0.98)
  const riskPct = ((price - stopPrice) / price) * 100, targetPrice = price + (price - stopPrice) * 2, trigger = breakout && resistance ? `breakout ${resistance.toFixed(2)}` : `momentum +${changePct.toFixed(2)}%`
  return { signal: true, reason: `BUY v1: Daily Bullish ${scan.bullProbability ?? "—"}/${scan.baseProbability ?? "—"}/${scan.bearProbability ?? "—"}; ${trigger}; volume pace ${pace?.toFixed(2)}x; giữ trên MA20/MA50; stop ${stopPrice.toFixed(2)} (${riskPct.toFixed(2)}%).`, stopPrice, targetPrice, riskPct, volumePace: pace }
}
export function evaluateExit(open: OpenRecommendationState, scan: SignalDailyScan | undefined, quote: LiveQuote, timestampMs = Date.now()): ExitDecision {
  const returnPct = ((quote.price - open.buyPrice) / open.buyPrice) * 100, maxFavorablePct = Math.max(open.maxFavorablePct ?? returnPct, returnPct), maxAdversePct = Math.min(open.maxAdversePct ?? returnPct, returnPct), pace = scan ? estimateVolumePace(scan, quote.totalVolume, timestampMs) : null
  if (quote.price <= open.stopPrice) return { signal: true, type: "EXIT_FAIL", reason: `Hard stop: giá ${quote.price.toFixed(2)} <= stop ${open.stopPrice.toFixed(2)}.`, volumePace: pace, returnPct, maxFavorablePct, maxAdversePct }
  if (scan && scan.taBias !== "Bullish") return { signal: true, type: "EXIT_FAIL", reason: `Daily thesis fail: Bias chuyển ${scan.taBias}; không còn điều kiện Bullish ban đầu.`, volumePace: pace, returnPct, maxFavorablePct, maxAdversePct }
  if (scan?.ma20 && quote.price < scan.ma20 && pace != null && pace >= 1.25) return { signal: true, type: "EXIT_FAIL", reason: `Structural fail: giá mất MA20 ${scan.ma20.toFixed(2)} với volume pace ${pace.toFixed(2)}x.`, volumePace: pace, returnPct, maxFavorablePct, maxAdversePct }
  const support = scan ? nearestBelow(parsePriceLevels(scan.support), open.buyPrice) : null
  if (support && quote.price < support && pace != null && pace >= 1.2) return { signal: true, type: "EXIT_FAIL", reason: `Acceptance risk dưới support ${support.toFixed(2)} với volume pace ${pace.toFixed(2)}x.`, volumePace: pace, returnPct, maxFavorablePct, maxAdversePct }
  return { signal: false, type: null, reason: "Open thesis vẫn hợp lệ", volumePace: pace, returnPct, maxFavorablePct, maxAdversePct }
}
