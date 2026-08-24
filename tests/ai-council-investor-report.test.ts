import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

import type { AiCouncilStock } from "../lib/ai-council-model.ts"

const moduleUrl = new URL("../lib/ai-council-investor-report.ts", import.meta.url)

const stock: AiCouncilStock = {
  ticker: "MSN",
  companyName: "Masan Group",
  sector: "Tiêu dùng",
  exchange: "HOSE",
  rank: 24,
  price: 70,
  changePct: 0.29,
  signal: "BUY_ON_CONFIRMATION",
  signalLabel: "BUY ON CONFIRMATION",
  councilScore: 62,
  confidence: 64,
  consensus: 60,
  consensusLabel: "Khá cao",
  bullVotes: 3,
  neutralVotes: 1,
  bearVotes: 1,
  riskStatus: "caution",
  confirmationPending: true,
  support: "66-68",
  resistance: "72-74",
  confirmation: "Vượt 72 và giữ được trên vùng breakout với volume xác nhận.",
  invalidation: "Đóng cửa dưới 66 làm hỏng cấu trúc hồi phục.",
  dataQuality: "HIGH",
  dataQualityDetail: "Multi-timeframe snapshots đầy đủ và không phát hiện provider fallback.",
  asOf: "2026-08-24T08:00:00.000Z",
  agents: [
    {
      key: "wyckoff",
      label: "Wyckoff Strategist",
      role: "Structure · Price/Volume · MTF",
      score: 62,
      confidence: 78,
      stance: "bullish",
      summary: "Daily đang cải thiện nhưng Weekly chưa đồng thuận.",
      evidenceFor: ["1D: Re-accumulation candidate"],
      evidenceAgainst: ["Xung đột HTF: Weekly bearish, Daily bullish"],
    },
    {
      key: "momentum",
      label: "Momentum Quant",
      role: "Trend · Momentum · Relative Strength",
      score: 58,
      confidence: 72,
      stance: "neutral",
      summary: "Momentum đang ở vùng trung tính, cần thêm follow-through.",
      evidenceFor: ["RS ngắn hạn 61/100"],
      evidenceAgainst: ["Giá còn dưới SMA200 -3.2%"],
    },
    {
      key: "fundamental",
      label: "Fundamental Analyst",
      role: "Earnings quality · Growth · Valuation",
      score: 78,
      confidence: 82,
      stance: "bullish",
      summary: "Nền tảng lợi nhuận hỗ trợ conviction trung hạn.",
      evidenceFor: ["Doanh thu TTM +12.0%", "LNST TTM +24.0%"],
      evidenceAgainst: [],
    },
    {
      key: "flow",
      label: "Flow Analyst",
      role: "Liquidity · Volume · Money flow",
      score: 65,
      confidence: 73,
      stance: "bullish",
      summary: "Dòng tiền xác nhận theo hướng tích cực.",
      evidenceFor: ["RelVolume D1 1.45x đi cùng giá tăng"],
      evidenceAgainst: [],
    },
    {
      key: "market",
      label: "Market Strategist",
      role: "Relative Strength · Sector context",
      score: 57,
      confidence: 62,
      stance: "neutral",
      summary: "Market context hiện chưa tạo edge đủ lớn.",
      evidenceFor: ["RS cổ phiếu 61 > RS ngành 55"],
      evidenceAgainst: [],
    },
    {
      key: "risk",
      label: "Risk / Devil's Advocate",
      role: "Conflict · Invalidation · Data quality",
      score: 46,
      confidence: 86,
      stance: "caution",
      summary: "Risk audit CAUTION: Timeframe conflict: Weekly bearish, Daily bullish.",
      evidenceFor: [],
      evidenceAgainst: [
        "Timeframe conflict: Weekly bearish, Daily bullish.",
        "Daily setup vẫn là candidate/watch; chưa hoàn tất Hold → Test → Follow-through.",
      ],
    },
  ],
  bullCase: ["Fundamental Analyst: Doanh thu TTM +12.0%", "Flow Analyst: RelVolume D1 1.45x đi cùng giá tăng"],
  bearCase: ["Risk: Timeframe conflict: Weekly bearish, Daily bullish."],
  dissent: "Risk audit CAUTION: Timeframe conflict: Weekly bearish, Daily bullish.",
  whatChangesDecision: [
    "Tăng conviction khi: Vượt 72 và giữ được trên vùng breakout với volume xác nhận.",
    "Hạ/đảo thesis khi: Đóng cửa dưới 66 làm hỏng cấu trúc hồi phục.",
  ],
}

async function loadReportModule() {
  if (!existsSync(fileURLToPath(moduleUrl))) return null
  return import(moduleUrl.href)
}

test("investor report presents the deterministic Council in investor-facing Vietnamese", async () => {
  const module = await loadReportModule()
  assert.ok(module, "lib/ai-council-investor-report.ts should exist")
  if (!module) return

  const report = module.buildInvestorCouncilReport(stock)

  assert.equal(report.recommendation, "MUA KHI XÁC NHẬN")
  assert.equal(report.confidenceLabel, "Trung bình")
  assert.equal(report.actionSummary, "Chưa mua đuổi; chỉ cân nhắc khi điều kiện xác nhận được đáp ứng.")
  assert.equal(report.confirmation, stock.confirmation)
  assert.equal(report.invalidation, stock.invalidation)
  assert.match(report.mainRisk, /Khung tuần/i)
  assert.match(report.mainRisk, /khung ngày/i)
  assert.doesNotMatch(report.mainRisk, /Risk audit|Timeframe conflict|Weekly bearish|Daily bullish/i)
})

test("investor report projects the six specialist scores into five readable pillars without changing the Council score", async () => {
  const module = await loadReportModule()
  assert.ok(module, "lib/ai-council-investor-report.ts should exist")
  if (!module) return

  const report = module.buildInvestorCouncilReport(stock)
  assert.equal(report.councilScore, 62)
  assert.deepEqual(report.pillars.map((pillar: { key: string; label: string; score: number }) => [pillar.key, pillar.label, pillar.score]), [
    ["fundamental", "Cơ bản", 78],
    ["technical", "Kỹ thuật", 60],
    ["flow", "Dòng tiền", 65],
    ["market", "Bối cảnh", 57],
    ["risk", "An toàn", 46],
  ])
})

test("investor report keeps evidence concise and removes internal agent prefixes from the simple narrative", async () => {
  const module = await loadReportModule()
  assert.ok(module, "lib/ai-council-investor-report.ts should exist")
  if (!module) return

  const report = module.buildInvestorCouncilReport(stock)
  assert.ok(report.whyInteresting.length >= 1 && report.whyInteresting.length <= 3)
  assert.ok(report.whyInteresting.some((item: string) => item.includes("Doanh thu TTM +12.0%")))
  for (const item of report.whyInteresting) {
    assert.doesNotMatch(item, /Fundamental Analyst:|Flow Analyst:|Wyckoff Strategist:|Momentum Quant:|Market Strategist:/)
  }
})

test("investor recommendation labels remain deterministic across all Council signals", async () => {
  const module = await loadReportModule()
  assert.ok(module, "lib/ai-council-investor-report.ts should exist")
  if (!module) return

  const expected = {
    BUY: "MUA",
    BUY_ON_CONFIRMATION: "MUA KHI XÁC NHẬN",
    WAIT: "CHỜ",
    REDUCE: "GIẢM TỶ TRỌNG",
    SELL: "BÁN / TRÁNH",
  } as const

  for (const [signal, recommendation] of Object.entries(expected)) {
    const report = module.buildInvestorCouncilReport({ ...stock, signal: signal as AiCouncilStock["signal"] })
    assert.equal(report.recommendation, recommendation)
  }
})
