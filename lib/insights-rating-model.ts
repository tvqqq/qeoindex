export interface RatingModelSnapshot {
  asOfDate: string
  ratingScore: number | null
  score4m: number | null
  canslimScore: number | null
  pricePotential: string | null
  rsShort: number | null
  rsMedium: number | null
  stockRrgState: string | null
  sectorRrgState: string | null
  rsi14: number | string | null
  weeklyChangePercent: number | null
  monthlyChangePercent: number | null
  beta: number | null
}

export type RatingDimensionKey = "bullish" | "accumulation" | "risk" | "heat" | "sustainable"

export interface RatingDimension {
  key: RatingDimensionKey
  label: string
  shortLabel: string
  description: string
  score: number
}

export interface RatingModelResult {
  dimensions: RatingDimension[]
  state: "Tích lũy kín" | "Tích lũy" | "Dẫn dắt" | "Quá nhiệt" | "Rủi ro cao" | "Trung lập"
  summary: string
}

const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)))
const score = (value: number | null, fallback = 50) => value == null ? fallback : clamp(value)
const signed = (value: number | null, fullScale: number) => value == null ? 50 : clamp(50 + value / fullScale * 50)

function rrgScore(value: string | null) {
  if (value === "Dẫn dắt") return 88
  if (value === "Phục hồi") return 67
  if (value === "Suy yếu") return 38
  if (value === "Đội sổ") return 18
  return 50
}

function potentialScore(value: string | null) {
  if (!value) return 50
  if (value.includes("Tăng") && value.includes("↑↑↑")) return 92
  if (value.includes("Tăng") && value.includes("↑↑")) return 80
  if (value.includes("Tăng")) return 68
  if (value.includes("Giảm") && value.includes("↓↓↓")) return 8
  if (value.includes("Giảm") && value.includes("↓↓")) return 20
  if (value.includes("Giảm")) return 32
  return 50
}

function rsiHeat(value: number | string | null) {
  if (typeof value === "number") return clamp((value - 40) * 2.5)
  const normalized = String(value || "").toLowerCase()
  if (normalized.includes("quá mua") || normalized.includes("overbought")) return 90
  if (normalized.includes("quá bán") || normalized.includes("oversold")) return 15
  return 50
}

function weighted(parts: Array<[number, number]>) {
  return clamp(parts.reduce((total, [value, weight]) => total + value * weight, 0))
}

/**
 * QeoIndex heuristic built only from the published KFSP read-model.
 * It is a comparison aid, not proprietary KFSP logic or an investment signal.
 */
export function calculateRatingModel(input: RatingModelSnapshot): RatingModelResult {
  const weekly = signed(input.weeklyChangePercent, 10)
  const monthly = signed(input.monthlyChangePercent, 20)
  const stockRrg = rrgScore(input.stockRrgState)
  const sectorRrg = rrgScore(input.sectorRrgState)
  const potential = potentialScore(input.pricePotential)
  const betaRisk = input.beta == null ? 50 : clamp(50 + (input.beta - 1) * 42)
  const downsideRisk = weighted([[100 - weekly, 0.55], [100 - monthly, 0.45]])

  const bullish = weighted([
    [score(input.rsShort), 0.24], [score(input.rsMedium), 0.2], [weekly, 0.2],
    [monthly, 0.18], [potential, 0.1], [stockRrg, 0.08],
  ])
  const heat = weighted([
    [weekly, 0.3], [monthly, 0.25], [rsiHeat(input.rsi14), 0.25],
    [score(input.rsShort), 0.1], [potential, 0.1],
  ])
  const risk = weighted([
    [betaRisk, 0.25], [downsideRisk, 0.25], [100 - score(input.ratingScore), 0.2],
    [100 - stockRrg, 0.15], [100 - sectorRrg, 0.15],
  ])
  const accumulation = weighted([
    [score(input.canslimScore), 0.2], [score(input.score4m), 0.16],
    [score(input.rsShort), 0.14], [score(input.rsMedium), 0.14],
    [stockRrg, 0.12], [sectorRrg, 0.1], [100 - Math.abs(heat - 55), 0.14],
  ])
  const sustainable = weighted([
    [score(input.canslimScore), 0.24], [score(input.score4m), 0.2],
    [score(input.ratingScore), 0.2], [score(input.rsMedium), 0.14],
    [sectorRrg, 0.12], [100 - risk, 0.1],
  ])

  let state: RatingModelResult["state"] = "Trung lập"
  let summary = "Các nhóm điểm chưa tạo thành một trạng thái nổi trội."
  if (risk >= 68) {
    state = "Rủi ro cao"
    summary = "Rủi ro giá và sức mạnh tương đối đang lấn át chất lượng điểm."
  } else if (heat >= 74 && bullish >= 62) {
    state = "Quá nhiệt"
    summary = "Động lượng mạnh nhưng độ nóng cao; cần theo dõi khả năng điều chỉnh."
  } else if (bullish >= 70 && sustainable >= 63) {
    state = "Dẫn dắt"
    summary = "Động lượng, chất lượng và độ bền đang đồng thuận ở vùng tích cực."
  } else if (accumulation >= 68 && heat <= 62) {
    state = "Tích lũy kín"
    summary = "Chất lượng và sức mạnh cải thiện trong khi biến động vẫn được kiểm soát."
  } else if (accumulation >= 58 && risk < 58) {
    state = "Tích lũy"
    summary = "Nền điểm tương đối cân bằng, phù hợp theo dõi quá trình gom nền."
  }

  return {
    dimensions: [
      { key: "bullish", label: "Xu hướng tăng", shortLabel: "BULL", description: "RS, biến động giá, tiềm năng và RRG.", score: bullish },
      { key: "accumulation", label: "Tích lũy", shortLabel: "ACC", description: "Chất lượng điểm trong vùng biến động kiểm soát.", score: accumulation },
      { key: "risk", label: "Rủi ro", shortLabel: "RISK", description: "Beta, giảm giá, điểm yếu và RRG bất lợi.", score: risk },
      { key: "heat", label: "Độ nóng", shortLabel: "HEAT", description: "Động lượng ngắn hạn và trạng thái RSI.", score: heat },
      { key: "sustainable", label: "Bền vững", shortLabel: "SUST", description: "CANSLIM, 4M, RSm và sức mạnh ngành.", score: sustainable },
    ],
    state,
    summary,
  }
}

export function historyDelta(current: number, history: RatingModelSnapshot[], days: number, selector: (snapshot: RatingModelSnapshot) => number | null) {
  if (!history.length) return null
  const currentDate = new Date(`${history[0]?.asOfDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const target = new Date(currentDate)
  target.setUTCDate(target.getUTCDate() - days)
  const targetTime = target.getTime()
  const snapshot = history
    .filter((item) => new Date(`${item.asOfDate}T00:00:00Z`).getTime() <= targetTime)
    .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0]
  const previous = snapshot ? selector(snapshot) : null
  return previous == null ? null : current - previous
}
