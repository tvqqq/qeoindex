import type { AiCouncilStock, CouncilAgentOpinion, CouncilSignal } from "@/lib/ai-council-model"

export type InvestorPillarKey = "fundamental" | "technical" | "flow" | "market" | "risk"

export interface InvestorCouncilPillar {
  key: InvestorPillarKey
  label: string
  score: number | null
}

export interface InvestorCouncilReport {
  recommendation: string
  actionSummary: string
  confidenceLabel: "Cao" | "Trung bình" | "Thấp"
  councilScore: number
  consensus: number
  pillars: InvestorCouncilPillar[]
  whyInteresting: string[]
  mainRisk: string
  confirmation: string
  invalidation: string
}

const RECOMMENDATION_LABEL: Record<CouncilSignal, string> = {
  BUY: "MUA",
  BUY_ON_CONFIRMATION: "MUA KHI XÁC NHẬN",
  WAIT: "CHỜ",
  REDUCE: "GIẢM TỶ TRỌNG",
  SELL: "BÁN / TRÁNH",
}

const ACTION_SUMMARY: Record<CouncilSignal, string> = {
  BUY: "Có thể cân nhắc mua theo kế hoạch; vẫn phải tuân thủ vùng vô hiệu của luận điểm.",
  BUY_ON_CONFIRMATION: "Chưa mua đuổi; chỉ cân nhắc khi điều kiện xác nhận được đáp ứng.",
  WAIT: "Tiếp tục quan sát; chưa có lợi thế đủ rõ để mở vị thế mới.",
  REDUCE: "Ưu tiên giảm tỷ trọng và bảo vệ thành quả cho tới khi cấu trúc cải thiện.",
  SELL: "Ưu tiên thoát hoặc tránh vị thế mới cho tới khi luận điểm được xây dựng lại.",
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function agent(stock: AiCouncilStock, key: CouncilAgentOpinion["key"]) {
  return stock.agents.find((item) => item.key === key)
}

function averageScores(items: Array<number | null | undefined>) {
  const values = items.filter((value): value is number => value != null && Number.isFinite(value))
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function confidenceLabel(value: number): InvestorCouncilReport["confidenceLabel"] {
  if (value >= 70) return "Cao"
  if (value >= 50) return "Trung bình"
  return "Thấp"
}

function stripAgentPrefix(value: string) {
  return value
    .replace(/^(Wyckoff Strategist|Momentum Quant|Fundamental Analyst|Flow Analyst|Market Strategist|Risk(?: \/ Devil's Advocate)?):\s*/i, "")
    .trim()
}

function humanizeRiskText(value: string) {
  const clean = stripAgentPrefix(value)
    .replace(/^Risk audit\s+(APPROVE|CAUTION|VETO):\s*/i, "")
    .replace(/^Risk:\s*/i, "")
    .trim()

  const timeframe = clean.match(/Timeframe conflict:\s*Weekly\s+(bullish|neutral|bearish),\s*Daily\s+(bullish|neutral|bearish)\.?/i)
  if (timeframe) {
    const weekly = timeframe[1].toLowerCase()
    const daily = timeframe[2].toLowerCase()
    if (weekly === "bearish" && daily === "bullish") {
      return "Khung tuần vẫn còn yếu trong khi khung ngày đang cải thiện; hai xu hướng chưa đồng thuận nên chưa phù hợp để mua đuổi."
    }
    if (weekly === "bullish" && daily === "bearish") {
      return "Khung tuần vẫn tích cực nhưng khung ngày đang suy yếu; hai xu hướng chưa đồng thuận nên cần ưu tiên kiểm soát rủi ro."
    }
    return "Khung tuần và khung ngày đang cho tín hiệu trái chiều; cần thêm xác nhận trước khi tăng độ tin cậy."
  }

  if (/Daily setup vẫn là candidate\/watch/i.test(clean)) {
    return "Thiết lập ngày vẫn đang ở trạng thái theo dõi; cần hoàn tất Hold → Test → Follow-through trước khi tăng độ tin cậy."
  }
  if (/Council disagreement lớn/i.test(clean)) {
    return "Các góc nhìn trong Hội đồng còn phân hóa mạnh; chưa nên ép một kịch bản duy nhất."
  }
  if (/provider fallback/i.test(clean)) {
    return "Một phần dữ liệu Wyckoff đang dùng nguồn dự phòng; cần giữ biên an toàn cao hơn khi ra quyết định."
  }
  if (/confidence LOW/i.test(clean)) {
    return "Có khung thời gian Wyckoff có độ tin cậy thấp; kết luận đa khung chưa đủ chắc."
  }
  if (/Thiếu multi-timeframe Wyckoff evidence/i.test(clean)) {
    return "Thiếu dữ liệu Wyckoff đa khung; chưa đủ cơ sở để nâng độ tin cậy cho cấu trúc giá."
  }

  return clean || "Chưa phát hiện rủi ro nổi trội ngoài các điều kiện vô hiệu đã nêu."
}

function whyInteresting(stock: AiCouncilStock) {
  const directional = stock.agents
    .filter((item) => item.key !== "risk")
    .sort((left, right) => right.score - left.score)
  const evidence = directional.flatMap((item) => item.evidenceFor.map(stripAgentPrefix))
  return unique(evidence).slice(0, 3)
}

export function buildInvestorCouncilReport(stock: AiCouncilStock): InvestorCouncilReport {
  const fundamental = agent(stock, "fundamental")
  const wyckoff = agent(stock, "wyckoff")
  const momentum = agent(stock, "momentum")
  const flow = agent(stock, "flow")
  const market = agent(stock, "market")
  const risk = agent(stock, "risk")
  const riskSource = risk?.evidenceAgainst[0] || risk?.summary || stock.dissent

  return {
    recommendation: RECOMMENDATION_LABEL[stock.signal],
    actionSummary: ACTION_SUMMARY[stock.signal],
    confidenceLabel: confidenceLabel(stock.confidence),
    councilScore: stock.councilScore,
    consensus: stock.consensus,
    pillars: [
      { key: "fundamental", label: "Cơ bản", score: fundamental?.score ?? null },
      { key: "technical", label: "Kỹ thuật", score: averageScores([wyckoff?.score, momentum?.score]) },
      { key: "flow", label: "Dòng tiền", score: flow?.score ?? null },
      { key: "market", label: "Bối cảnh", score: market?.score ?? null },
      { key: "risk", label: "An toàn", score: risk?.score ?? null },
    ],
    whyInteresting: whyInteresting(stock),
    mainRisk: humanizeRiskText(riskSource),
    confirmation: stock.confirmation,
    invalidation: stock.invalidation,
  }
}
