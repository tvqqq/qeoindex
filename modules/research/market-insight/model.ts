import type { MarketRegime, RotationState, QualityStatus } from "@/supabase/functions/_shared/market-close-normalizer"

export interface MarketObservationEvidence {
  field: string
  value: string | number | null
  unit?: string
}

export interface MarketObservation {
  id: string
  title: string
  content: string
  category: "regime" | "liquidity" | "health" | "sectors" | "leaders"
  sentiment: "positive" | "neutral" | "negative" | "warning"
  evidenceRefs: MarketObservationEvidence[]
}

export interface MarketObservationSnapshotInput {
  sessionDate: string
  asOf: string
  regime: MarketRegime | null
  daily: {
    sentimentScore: number | null
    sentimentLabel: string | null
    riskScore: number | null
    riskLabel: string | null
    distributionCount: number | null
    aboveMa10Pct: number | null
    aboveMa20Pct: number | null
    aboveMa50Pct: number | null
    aboveMa200Pct: number | null
    foreignNetValue: number | null
    proprietaryNetValue: number | null
    totalMatchedVolume: number | null
    totalTradedValue: number | null
    qualityStatus: QualityStatus
  }
  indexes: Array<{
    indexCode: string
    value: number | null
    change: number | null
    changePct: number | null
    tradedValue: number | null
    advances: number
    unchanged: number
    declines: number
    ceilings: number
    floors: number
  }>
  sectors: Array<{
    sectorKey: string
    displayName: string
    timeWindow: "1d" | "5d" | "20d"
    tradedValue: number | null
    averageChangePct: number | null
    rsScore: number | null
    rotationState: RotationState
    advances: number
    declines: number
  }>
  leaders: Array<{
    category: string
    rank: number
    ticker: string
    price: number | null
    changePct: number | null
    estimatedIndexPoints: number | null
    metricValue: number | null
    metricLabel: string | null
  }>
}

function formatNumber(num: number | null | undefined, decimals = 2): string {
  if (num == null || !Number.isFinite(num)) return "—"
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num)
}

function formatSigned(num: number | null | undefined, decimals = 2, suffix = ""): string {
  if (num == null || !Number.isFinite(num)) return "—"
  const sign = num > 0 ? "+" : ""
  return `${sign}${formatNumber(num, decimals)}${suffix}`
}

export function generateMarketObservations(input: MarketObservationSnapshotInput): MarketObservation[] {
  const observations: MarketObservation[] = []
  const vnindex = input.indexes.find((i) => i.indexCode === "VNINDEX")

  // Observation 1: Index direction and Breadth consensus/divergence
  if (vnindex && vnindex.value != null && vnindex.changePct != null) {
    const totalBreadth = vnindex.advances + vnindex.declines
    const advanceRatio = totalBreadth > 0 ? vnindex.advances / totalBreadth : 0.5
    const isUp = vnindex.changePct > 0
    const isBreadthSupportive = isUp ? advanceRatio >= 0.55 : advanceRatio <= 0.45
    const isDivergent = (isUp && advanceRatio < 0.45) || (!isUp && advanceRatio > 0.55)

    const title = "Chỉ số & Độ rộng thị trường"
    let content = ""
    let sentiment: MarketObservation["sentiment"] = isUp ? "positive" : "negative"
    const ceilingFloorText = (vnindex.ceilings > 0 || vnindex.floors > 0)
      ? ` (${vnindex.ceilings} mã trần, ${vnindex.floors} mã sàn)`
      : ""

    if (isDivergent) {
      sentiment = "warning"
      content = `VNINDEX ${isUp ? "tăng" : "giảm"} ${formatSigned(vnindex.change, 2)} điểm (${formatSigned(vnindex.changePct, 2, "%")}) nhưng độ rộng ghi nhận phân kỳ với ${vnindex.advances} mã tăng so với ${vnindex.declines} mã giảm. Sự phân hóa sâu sắc cho thấy dòng tiền chỉ tập trung ở số ít nhóm cổ phiếu.`
    } else if (isBreadthSupportive) {
      content = `VNINDEX ${isUp ? "tăng" : "giảm"} ${formatSigned(vnindex.change, 2)} điểm (${formatSigned(vnindex.changePct, 2, "%")}), đồng thuận cùng độ rộng thị trường với ${vnindex.advances} mã tăng áp đảo ${vnindex.declines} mã giảm${ceilingFloorText}.`
    } else {
      sentiment = "neutral"
      content = `VNINDEX đóng cửa tại ${formatNumber(vnindex.value)} điểm (${formatSigned(vnindex.changePct, 2, "%")}) trong trạng thái giằng co phân hóa: ${vnindex.advances} mã tăng, ${vnindex.unchanged} mã đi ngang và ${vnindex.declines} mã giảm${ceilingFloorText}.`
    }

    observations.push({
      id: "obs_index_breadth",
      title,
      content,
      category: "regime",
      sentiment,
      evidenceRefs: [
        { field: "vnindex_close", value: vnindex.value, unit: "points" },
        { field: "vnindex_change_pct", value: vnindex.changePct, unit: "%" },
        { field: "advances", value: vnindex.advances, unit: "stocks" },
        { field: "declines", value: vnindex.declines, unit: "stocks" },
      ],
    })
  }

  // Observation 2: Liquidity and Foreign / Proprietary Flows
  const foreignNet = input.daily.foreignNetValue
  const propNet = input.daily.proprietaryNetValue
  const totalVal = input.daily.totalTradedValue ?? vnindex?.tradedValue

  if (totalVal != null || foreignNet != null || propNet != null) {
    const parts: string[] = []
    const evidence: MarketObservationEvidence[] = []

    if (totalVal != null) {
      parts.push(`Thanh khoản khớp lệnh đạt ${formatNumber(totalVal, 0)} tỷ đồng`)
      evidence.push({ field: "total_traded_value", value: totalVal, unit: "billion_vnd" })
    }

    if (foreignNet != null) {
      const action = foreignNet >= 0 ? "mua ròng" : "bán ròng"
      parts.push(`khối ngoại ${action} ${formatSigned(foreignNet, 1)} tỷ đồng`)
      evidence.push({ field: "foreign_net_value", value: foreignNet, unit: "billion_vnd" })
    }

    if (propNet != null) {
      const action = propNet >= 0 ? "mua ròng" : "bán ròng"
      parts.push(`tự doanh ${action} ${formatSigned(propNet, 1)} tỷ đồng`)
      evidence.push({ field: "proprietary_net_value", value: propNet, unit: "billion_vnd" })
    }

    let sentiment: MarketObservation["sentiment"] = "neutral"
    if (foreignNet != null && foreignNet > 100) sentiment = "positive"
    else if (foreignNet != null && foreignNet < -300) sentiment = "warning"

    observations.push({
      id: "obs_liquidity_flows",
      title: "Thanh khoản & Dòng tiền tổ chức",
      content: parts.join("; ") + ".",
      category: "liquidity",
      sentiment,
      evidenceRefs: evidence,
    })
  }

  // Observation 3: Moving Average Breadth & Structural Market Health
  const ma20 = input.daily.aboveMa20Pct
  const ma50 = input.daily.aboveMa50Pct
  const distCount = input.daily.distributionCount
  const riskScore = input.daily.riskScore

  if (ma20 != null || distCount != null || riskScore != null) {
    const parts: string[] = []
    const evidence: MarketObservationEvidence[] = []

    if (ma20 != null && ma50 != null) {
      parts.push(`Độ rộng trung hạn duy trì ở mức ${formatNumber(ma20, 1)}% cổ phiếu trên MA20 và ${formatNumber(ma50, 1)}% trên MA50`)
      evidence.push(
        { field: "above_ma20_pct", value: ma20, unit: "%" },
        { field: "above_ma50_pct", value: ma50, unit: "%" },
      )
    }

    if (distCount != null) {
      const statusLabel = distCount <= 2 ? "vùng an toàn" : distCount <= 4 ? "vùng theo dõi" : "vùng rủi ro cao"
      parts.push(`số ngày phân phối do KFSP công bố là ${distCount} phiên (${statusLabel})`)
      evidence.push({ field: "distribution_count", value: distCount, unit: "sessions" })
    }

    if (riskScore != null) {
      evidence.push({ field: "risk_score", value: riskScore, unit: "ratio_0_1" })
    }

    let sentiment: MarketObservation["sentiment"] = "neutral"
    if ((distCount != null && distCount >= 5) || (riskScore != null && riskScore >= 0.7)) sentiment = "warning"
    else if (ma20 != null && ma20 >= 60 && (distCount == null || distCount <= 2)) sentiment = "positive"

    observations.push({
      id: "obs_structural_health",
      title: "Sức khỏe cấu trúc & Phân phối",
      content: parts.join("; ") + ".",
      category: "health",
      sentiment,
      evidenceRefs: evidence,
    })
  }

  // Observation 4: Leading Sectors & Rotation
  const leadingSectors = input.sectors
    .filter((s) => s.rotationState === "leading" || (s.rsScore != null && s.rsScore >= 75))
    .sort((a, b) => (b.rsScore ?? 0) - (a.rsScore ?? 0))
    .slice(0, 3)

  if (leadingSectors.length > 0) {
    const names = leadingSectors
      .map((s) => `${s.displayName} (${formatSigned(s.averageChangePct, 1, "%")}${s.rsScore != null ? `, RS ${formatNumber(s.rsScore, 0)}` : ""})`)
      .join(", ")

    observations.push({
      id: "obs_sector_rotation",
      title: "Ngành dẫn dắt & Dòng tiền",
      content: `Dòng tiền tập trung dẫn dắt tại nhóm ngành: ${names}. Sự luân chuyển dòng tiền lành mạnh là động lực quan trọng nâng đỡ xu hướng chung.`,
      category: "sectors",
      sentiment: "positive",
      evidenceRefs: leadingSectors.map((s) => ({
        field: `sector_${s.sectorKey}_rs`,
        value: s.rsScore,
        unit: "score_0_100",
      })),
    })
  }

  // Observation 5: Index Contributors
  const topUp = input.leaders.filter((l) => l.category === "index_up").slice(0, 2)
  const topDown = input.leaders.filter((l) => l.category === "index_down").slice(0, 2)

  if (topUp.length > 0 || topDown.length > 0) {
    const upStr = topUp.length > 0
      ? `Nâng đỡ chỉ số: ${topUp.map((l) => `${l.ticker} (${formatSigned(l.estimatedIndexPoints, 2)} đ)`).join(", ")}`
      : ""
    const downStr = topDown.length > 0
      ? `Gây áp lực giảm: ${topDown.map((l) => `${l.ticker} (${formatSigned(l.estimatedIndexPoints, 2)} đ)`).join(", ")}`
      : ""

    const text = [upStr, downStr].filter(Boolean).join("; ") + "."
    observations.push({
      id: "obs_index_impact",
      title: "Tác động điểm số chỉ số",
      content: text,
      category: "leaders",
      sentiment: "neutral",
      evidenceRefs: [
        ...topUp.map((l) => ({ field: `impact_${l.ticker}`, value: l.estimatedIndexPoints, unit: "points" })),
        ...topDown.map((l) => ({ field: `impact_${l.ticker}`, value: l.estimatedIndexPoints, unit: "points" })),
      ],
    })
  }

  return observations
}
