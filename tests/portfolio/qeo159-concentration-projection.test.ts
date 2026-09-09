import assert from "node:assert/strict"
import test from "node:test"

import { projectTradeConcentration } from "../../modules/portfolio/concentration/project-trade.ts"
import type { PortfolioConcentrationReadModel } from "../../modules/portfolio/concentration/types.ts"
import type { DiversificationRules } from "../../modules/portfolio/risk-plan/types.ts"

const rules: DiversificationRules = {
  enabled: true,
  concentrationWarningPercent: 25,
  maxTickerConcentrationPercent: 30,
  maxSectorRiskPercent: 5,
  maxConcurrentOpenPositions: 3,
}

function current(overrides: Partial<PortfolioConcentrationReadModel> = {}): PortfolioConcentrationReadModel {
  return {
    summary: { overallStatus: "WITHIN_PLAN", openPositionCount: 2, accountEquityVnd: 100_000_000 },
    rules,
    tickerMarketValue: [],
    tickerActiveRisk: [],
    sectorActiveRisk: [],
    openPositions: {
      id: "open_position_count",
      kind: "open_position_count",
      status: "WITHIN_PLAN",
      metricValue: 2,
      metricUnit: "count",
      amountVnd: null,
      warningThreshold: null,
      breachThreshold: 3,
      ticker: null,
      sector: null,
      basis: "distinct canonical tickers with positive open quantity",
      completeness: "complete",
      provenance: ["canonical_holdings"],
      reason: "within_configured_limit",
    },
    unknownClassificationTickers: [],
    snapshot: {
      tickerMarketValueVnd: { MSN: 20_000_000, FPT: 15_000_000 },
      tickerKnownActiveRiskVnd: { MSN: 2_000_000, FPT: 1_000_000 },
      sectorKnownActiveRiskVnd: { "Tiêu dùng & Bán lẻ": 2_000_000, "Công nghệ": 1_000_000 },
      openTickers: ["FPT", "MSN"],
    },
    evidence: {
      holdingsCompleteness: "complete",
      activeRiskCoverage: "complete",
      sectorMetadataCoverage: "complete",
      sectorSourceAsOfDate: "2026-09-09",
      moneyManagementPlanVersion: 4,
    },
    ...overrides,
  }
}

test("planned new trade can create deterministic ticker and sector breaches without altering trade sizing inputs", () => {
  const trade = {
    ticker: "MWG",
    plannedQty: 2_000,
    plannedEntryKvnd: 20,
    plannedRiskVnd: 4_000_000,
    sector: "Tiêu dùng & Bán lẻ",
  }
  const before = structuredClone(trade)
  const result = projectTradeConcentration({ current: current(), accountEquityVnd: 100_000_000, rules, trade })

  assert.deepEqual(trade, before)
  assert.equal(result.tickerMarketValue.metricValue, 40)
  assert.equal(result.tickerMarketValue.status, "BREACH")
  assert.equal(result.sectorActiveRisk.metricValue, 6)
  assert.equal(result.sectorActiveRisk.status, "BREACH")
  assert.equal(result.openPositions.metricValue, 3)
  assert.equal(result.openPositions.status, "WITHIN_PLAN")
  assert.equal(result.projectedTrade.plannedQty, 2_000)
  assert.equal(result.projectedTrade.plannedRiskVnd, 4_000_000)
})

test("scale-in adds concentration but does not increment distinct open-position count", () => {
  const result = projectTradeConcentration({
    current: current(),
    accountEquityVnd: 100_000_000,
    rules,
    trade: { ticker: "MSN", plannedQty: 500, plannedEntryKvnd: 20, plannedRiskVnd: 500_000, sector: "Tiêu dùng & Bán lẻ" },
  })

  assert.equal(result.openPositions.metricValue, 2)
  assert.equal(result.tickerMarketValue.amountVnd, 30_000_000)
  assert.equal(result.tickerMarketValue.metricValue, 30)
})

test("new ticker increments position count and can breach configured position cap", () => {
  const result = projectTradeConcentration({
    current: current({
      summary: { overallStatus: "WITHIN_PLAN", openPositionCount: 3, accountEquityVnd: 100_000_000 },
      snapshot: {
        tickerMarketValueVnd: { MSN: 20_000_000, FPT: 15_000_000, VCB: 10_000_000 },
        tickerKnownActiveRiskVnd: { MSN: 2_000_000, FPT: 1_000_000, VCB: 500_000 },
        sectorKnownActiveRiskVnd: { "Tiêu dùng & Bán lẻ": 2_000_000, "Công nghệ": 1_000_000, "Ngân hàng": 500_000 },
        openTickers: ["FPT", "MSN", "VCB"],
      },
    }),
    accountEquityVnd: 100_000_000,
    rules,
    trade: { ticker: "HPG", plannedQty: 100, plannedEntryKvnd: 30, plannedRiskVnd: 200_000, sector: "Công nghiệp & Vật liệu" },
  })

  assert.equal(result.openPositions.metricValue, 4)
  assert.equal(result.openPositions.status, "BREACH")
})

test("planned trade with unknown structured sector returns UNKNOWN sector projection", () => {
  const result = projectTradeConcentration({
    current: current(),
    accountEquityVnd: 100_000_000,
    rules,
    trade: { ticker: "ZZZ", plannedQty: 100, plannedEntryKvnd: 10, plannedRiskVnd: 200_000, sector: null },
  })

  assert.equal(result.sectorActiveRisk.status, "UNKNOWN")
  assert.equal(result.sectorActiveRisk.metricValue, null)
  assert.equal(result.sectorActiveRisk.reason, "unknown_sector_classification")
})

test("projection uses current Account Equity denominator and fails closed when denominator is unavailable", () => {
  const known = projectTradeConcentration({
    current: current(),
    accountEquityVnd: 100_000_000,
    rules,
    trade: { ticker: "MWG", plannedQty: 1_000, plannedEntryKvnd: 10, plannedRiskVnd: 1_000_000, sector: "Tiêu dùng & Bán lẻ" },
  })
  assert.equal(known.tickerMarketValue.metricValue, 10)
  assert.equal(known.basis.accountEquityVnd, 100_000_000)

  const unknown = projectTradeConcentration({
    current: current(),
    accountEquityVnd: null,
    rules,
    trade: { ticker: "MWG", plannedQty: 1_000, plannedEntryKvnd: 10, plannedRiskVnd: 1_000_000, sector: "Tiêu dùng & Bán lẻ" },
  })
  assert.equal(unknown.tickerMarketValue.metricValue, null)
  assert.equal(unknown.tickerMarketValue.status, "UNKNOWN")
})
