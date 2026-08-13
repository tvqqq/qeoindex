import { aggregateWeekly, calculateTechnicalSnapshot, type OhlcvBar, type TechnicalSnapshot } from "@/lib/technical-indicators"

export type ScannerBias = "Bullish" | "Neutral" | "Bearish" | "Mixed"
export type ScannerConfidence = "HIGH" | "MEDIUM" | "LOW"

export interface WyckoffScanResult {
  technical: TechnicalSnapshot
  wyckoffState: string
  phase: string
  taBias: ScannerBias
  bullProbability: number
  baseProbability: number
  bearProbability: number
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  confidence: ScannerConfidence
  tags: string[]
}

function pctPosition(value: number, low: number, high: number) {
  return high > low ? (value - low) / (high - low) : 0.5
}

function roundPrice(value: number) {
  if (value >= 1000) return Math.round(value).toLocaleString("en-US")
  if (value >= 100) return value.toFixed(1)
  if (value >= 10) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function probabilitiesFromScore(score: number, unresolved: boolean) {
  const directional = clamp(Math.round(Math.abs(score) * 5), 0, 25)
  let base = unresolved ? 55 - directional : 45 - Math.floor(directional / 2)
  let bull = score >= 0 ? 25 + directional : 25 - Math.floor(directional / 2)
  let bear = score <= 0 ? 25 + directional : 25 - Math.floor(directional / 2)
  bull = clamp(bull, 10, 70)
  bear = clamp(bear, 10, 70)
  base = clamp(base, 20, 60)
  const total = bull + base + bear
  const scale = 100 / total
  bull = Math.round(bull * scale)
  bear = Math.round(bear * scale)
  base = 100 - bull - bear
  return { bull, base, bear }
}

function previousRange(bars: OhlcvBar[], period: number) {
  const prior = bars.slice(-(period + 1), -1)
  return {
    high: Math.max(...prior.map((bar) => bar.high)),
    low: Math.min(...prior.map((bar) => bar.low)),
  }
}

export function scanWyckoff(bars: OhlcvBar[], previous?: WyckoffScanResult | null): WyckoffScanResult {
  if (bars.length < 60) throw new Error("Cần tối thiểu 60 nến Daily để quét Wyckoff")

  const technical = calculateTechnicalSnapshot(bars)
  const latest = bars.at(-1)!
  const prior20 = previousRange(bars, 20)
  const prior60 = previousRange(bars, 60)
  const rangePos = pctPosition(latest.close, prior60.low, prior60.high)
  const closeLocation = pctPosition(latest.close, latest.low, latest.high)
  const relVol = technical.relVolume ?? 1
  const weekly = aggregateWeekly(bars)
  const weekly20 = weekly.slice(-20)
  const weeklyHigh = weekly20.length ? Math.max(...weekly20.map((bar) => bar.high)) : latest.high
  const weeklyLow = weekly20.length ? Math.min(...weekly20.map((bar) => bar.low)) : latest.low

  const springCandidate = latest.low < prior20.low && latest.close > prior20.low && closeLocation > 0.55
  const utCandidate = latest.high > prior20.high && latest.close < prior20.high && closeLocation < 0.45
  const sosCandidate = latest.close > prior20.high && closeLocation > 0.65 && relVol >= 1.1
  const sowCandidate = latest.close < prior20.low && closeLocation < 0.35 && relVol >= 1.1

  let score = 0
  if (technical.ma20 != null) score += latest.close > technical.ma20 ? 0.6 : -0.6
  if (technical.ma50 != null) score += latest.close > technical.ma50 ? 0.8 : -0.8
  if (technical.ma200 != null) score += latest.close > technical.ma200 ? 1 : -1
  if (technical.rsi14 != null) score += technical.rsi14 >= 55 ? 0.5 : technical.rsi14 <= 45 ? -0.5 : 0
  if (technical.macd != null && technical.macdSignal != null) score += technical.macd > technical.macdSignal ? 0.5 : -0.5
  if (rangePos > 0.72) score += 0.35
  if (rangePos < 0.28) score -= 0.35
  if (springCandidate) score += 1
  if (sosCandidate) score += 1.5
  if (utCandidate) score -= 1
  if (sowCandidate) score -= 1.5

  let wyckoffState = "Trading range / cấu trúc chưa đủ để gắn nhãn Wyckoff"
  let phase = "Unclassified"
  const tags: string[] = []
  let unresolved = true

  if (springCandidate) {
    wyckoffState = "Spring/Shakeout candidate — giá xuyên hỗ trợ ngắn hạn rồi đóng cửa trở lại trong range; cần Test và follow-through"
    phase = "Accumulation/Reaccumulation Phase C candidate"
    tags.push("Spring candidate", "Needs Test")
  } else if (utCandidate) {
    wyckoffState = "UT/UTAD candidate — giá xuyên kháng cự ngắn hạn nhưng không giữ được phía trên; cần quan sát phản ứng cung tiếp theo"
    phase = "Distribution/Redistribution Phase C candidate"
    tags.push("UT/UTAD candidate", "Needs confirmation")
  } else if (sosCandidate) {
    wyckoffState = "SOS candidate — breakout khỏi range 20 phiên với close mạnh và volume tương đối tăng; chưa coi là Phase D hoàn chỉnh trước Hold → Test → Follow-through"
    phase = "Accumulation/Reaccumulation Phase D candidate"
    tags.push("SOS candidate", "Breakout")
    unresolved = false
  } else if (sowCandidate) {
    wyckoffState = "SOW candidate — breakdown khỏi range 20 phiên với close yếu và volume tương đối tăng; cần hold dưới hỗ trợ/retest thất bại để xác nhận"
    phase = "Distribution/Redistribution Phase D candidate"
    tags.push("SOW candidate", "Breakdown")
    unresolved = false
  } else if (technical.ma50 != null && technical.ma200 != null && latest.close > technical.ma50 && latest.close > technical.ma200 && rangePos > 0.55) {
    wyckoffState = "Xu hướng tăng / markup hoặc reaccumulation chưa hoàn tất nhãn sự kiện; ưu tiên theo dõi pullback có volume co lại và khả năng giữ hỗ trợ"
    phase = "Markup / Reaccumulation watch"
    tags.push("Above MA50", "Above MA200")
  } else if (technical.ma50 != null && technical.ma200 != null && latest.close < technical.ma50 && latest.close < technical.ma200 && rangePos < 0.45) {
    wyckoffState = "Xu hướng giảm / markdown hoặc redistribution watch; ưu tiên theo dõi rally yếu, volume cầu suy giảm và khả năng mất hỗ trợ"
    phase = "Markdown / Redistribution watch"
    tags.push("Below MA50", "Below MA200")
  }

  const probabilities = probabilitiesFromScore(score, unresolved)
  const taBias: ScannerBias = score >= 2 ? "Bullish" : score <= -2 ? "Bearish" : Math.abs(score) < 0.75 ? "Neutral" : "Mixed"
  const confidence: ScannerConfidence = bars.length >= 220 && Math.abs(score) >= 2.5 ? "HIGH" : bars.length >= 120 ? "MEDIUM" : "LOW"

  const supports = [prior20.low, prior60.low, technical.ma50, technical.ma200]
    .filter((value): value is number => value != null && value < latest.close)
    .sort((a, b) => b - a)
    .slice(0, 3)
  const resistances = [prior20.high, prior60.high, weeklyHigh]
    .filter((value) => value > latest.close)
    .sort((a, b) => a - b)
    .slice(0, 3)

  const support = supports.length ? supports.map(roundPrice).join(" · ") : roundPrice(Math.min(prior20.low, weeklyLow))
  const resistance = resistances.length ? resistances.map(roundPrice).join(" · ") : roundPrice(Math.max(prior20.high, weeklyHigh))

  let confirmation = "Break → Hold → Test → Follow-through tại vùng quyết định gần nhất; ưu tiên volume expansion ở nhịp đi đúng thesis và contraction ở reaction."
  let invalidation = `Acceptance dưới ${roundPrice(prior20.low)} làm suy yếu cấu trúc tăng; acceptance trên ${roundPrice(prior20.high)} làm suy yếu cấu trúc giảm.`
  if (springCandidate) {
    confirmation = `Test giữ trên vùng ${roundPrice(prior20.low)}, volume co lại, sau đó reclaim ${roundPrice(prior20.high)} hoặc tạo SOS rõ.`
    invalidation = `Quay lại dưới ${roundPrice(prior20.low)} và tiếp tục giảm với supply expansion làm Spring candidate thất bại.`
  } else if (sosCandidate) {
    confirmation = `Giữ trên ${roundPrice(prior20.high)}, retest thành công và có follow-through; breakout đơn lẻ chưa đủ.`
    invalidation = `Đóng/acceptance trở lại dưới ${roundPrice(prior20.high)} làm SOS candidate thất bại.`
  } else if (utCandidate) {
    confirmation = `Không reclaim ${roundPrice(prior20.high)}, rally test yếu và sau đó mất hỗ trợ gần nhất.`
    invalidation = `Acceptance trở lại trên ${roundPrice(prior20.high)} với demand expansion làm UT/UTAD candidate thất bại.`
  } else if (sowCandidate) {
    confirmation = `Giữ dưới ${roundPrice(prior20.low)}, retest thất bại và có follow-through giảm.`
    invalidation = `Reclaim/acceptance trở lại trên ${roundPrice(prior20.low)} làm SOW candidate thất bại.`
  }

  const deltaText = previous
    ? `So với scan trước: Bull ${previous.bullProbability}→${probabilities.bull}%, Base ${previous.baseProbability}→${probabilities.base}%, Bear ${previous.bearProbability}→${probabilities.bear}%.`
    : "Baseline scan: chưa có phiên trước để so sánh xác suất."
  const signalText = tags.length ? ` Tín hiệu: ${tags.join(", ")}.` : " Chưa có Wyckoff event đủ điều kiện gắn nhãn."

  return {
    technical,
    wyckoffState,
    phase,
    taBias,
    bullProbability: probabilities.bull,
    baseProbability: probabilities.base,
    bearProbability: probabilities.bear,
    support,
    resistance,
    confirmation,
    invalidation,
    whatChanged: `${deltaText}${signalText}`,
    confidence,
    tags,
  }
}
