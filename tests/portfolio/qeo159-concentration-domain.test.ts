import assert from "node:assert/strict"
import test from "node:test"

import type { DiversificationRules } from "../../modules/portfolio/risk-plan/types.ts"

async function loadDomain() {
  return import("../../modules/portfolio/concentration/evaluate-current.ts")
}

function rules(overrides: Partial<DiversificationRules> = {}): DiversificationRules {
  return { enabled: true, ...overrides }
}

function sector(ticker: string, value: string | null) {
  return {
    ticker,
    sector: value,
    source: "canonical_market_universe" as const,
    sourceAsOfDate: "2026-09-09",
  }
}

test("ticker market-value concentration uses canonical Account Equity and configured hard limit", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "AAA", openQty: 1_000, currentPriceKvnd: 40 }],
    activeRiskRows: [],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules({ maxTickerConcentrationPercent: 35 }),
    planVersion: 3,
  })

  const check = model.tickerMarketValue[0]!
  assert.equal(check.ticker, "AAA")
  assert.equal(check.metricValue, 40)
  assert.equal(check.amountVnd, 40_000_000)
  assert.equal(check.breachThreshold, 35)
  assert.equal(check.status, "BREACH")
  assert.equal(model.summary.overallStatus, "BREACH")
  assert.equal(model.snapshot.tickerMarketValueVnd.AAA, 40_000_000)
})

test("warning threshold is advisory and does not become an implicit hard breach", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const warning = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "AAA", openQty: 1_000, currentPriceKvnd: 25 }],
    activeRiskRows: [],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules({ concentrationWarningPercent: 20 }),
    planVersion: 1,
  }).tickerMarketValue[0]!

  assert.equal(warning.status, "WARNING")
  assert.equal(warning.warningThreshold, 20)
  assert.equal(warning.breachThreshold, null)

  const within = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "AAA", openQty: 1_000, currentPriceKvnd: 10 }],
    activeRiskRows: [],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules({ concentrationWarningPercent: 20 }),
    planVersion: 1,
  }).tickerMarketValue[0]!
  assert.equal(within.status, "WITHIN_PLAN")
})

test("sector Active Risk reuses known QEO-141 amounts and can prove a hard breach", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [
      { ticker: "AAA", openQty: 100, currentPriceKvnd: 20 },
      { ticker: "BBB", openQty: 100, currentPriceKvnd: 30 },
    ],
    activeRiskRows: [
      { tradeId: "a1", ticker: "AAA", activeRiskVnd: 4_000_000, riskStatus: "known" },
      { tradeId: "b1", ticker: "BBB", activeRiskVnd: 3_000_000, riskStatus: "known" },
    ],
    sectors: [sector("AAA", "Ngân hàng"), sector("BBB", "Ngân hàng")],
    rules: rules({ maxSectorRiskPercent: 6 }),
    planVersion: 4,
  })

  const check = model.sectorActiveRisk.find((item) => item.sector === "Ngân hàng")!
  assert.equal(check.amountVnd, 7_000_000)
  assert.equal(check.metricValue, 7)
  assert.equal(check.status, "BREACH")
  assert.equal(model.snapshot.sectorKnownActiveRiskVnd["Ngân hàng"], 7_000_000)
  assert.equal(model.snapshot.tickerKnownActiveRiskVnd.AAA, 4_000_000)
  assert.equal(model.snapshot.tickerKnownActiveRiskVnd.BBB, 3_000_000)
})

test("missing structured sector classification stays explicit UNKNOWN and is never guessed", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "ZZZ", openQty: 100, currentPriceKvnd: 10 }],
    activeRiskRows: [{ tradeId: "z1", ticker: "ZZZ", activeRiskVnd: 1_000_000, riskStatus: "known" }],
    sectors: [sector("ZZZ", null)],
    rules: rules({ maxSectorRiskPercent: 6 }),
    planVersion: 2,
  })

  assert.deepEqual(model.unknownClassificationTickers, ["ZZZ"])
  assert.equal(model.evidence.sectorMetadataCoverage, "insufficient")
  assert.equal(model.sectorActiveRisk.some((item) => item.sector === "Công nghiệp & Vật liệu"), false)
  assert.equal(model.sectorActiveRisk.some((item) => item.status === "UNKNOWN"), true)
})

test("no configured relevant threshold never invents a plan-safe state", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "AAA", openQty: 100, currentPriceKvnd: 10 }],
    activeRiskRows: [],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules(),
    planVersion: 1,
  })

  assert.equal(model.tickerMarketValue[0]!.status, "UNKNOWN")
  assert.equal(model.tickerMarketValue[0]!.reason, "rule_not_configured")
  assert.equal(model.openPositions.status, "UNKNOWN")
  assert.equal(model.openPositions.reason, "rule_not_configured")
})

test("partial sector risk may prove breach but cannot prove safety", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const base = {
    accountEquityVnd: 100_000_000,
    positions: [{ ticker: "AAA", openQty: 100, currentPriceKvnd: 10 }],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules({ maxSectorRiskPercent: 6 }),
    planVersion: 1,
  }

  const breach = evaluateCurrentConcentration({
    ...base,
    activeRiskRows: [
      { tradeId: "a1", ticker: "AAA", activeRiskVnd: 7_000_000, riskStatus: "known" as const },
      { tradeId: "a2", ticker: "AAA", activeRiskVnd: null, riskStatus: "unknown" as const },
    ],
  }).sectorActiveRisk.find((item) => item.sector === "Ngân hàng")!
  assert.equal(breach.completeness, "partial")
  assert.equal(breach.status, "BREACH")

  const unknown = evaluateCurrentConcentration({
    ...base,
    activeRiskRows: [
      { tradeId: "a1", ticker: "AAA", activeRiskVnd: 5_000_000, riskStatus: "known" as const },
      { tradeId: "a2", ticker: "AAA", activeRiskVnd: null, riskStatus: "unknown" as const },
    ],
  }).sectorActiveRisk.find((item) => item.sector === "Ngân hàng")!
  assert.equal(unknown.completeness, "partial")
  assert.equal(unknown.status, "UNKNOWN")
  assert.equal(unknown.reason, "incomplete_risk_evidence")
})

test("multiple open Trade rows aggregate by ticker while open-position limit counts distinct canonical tickers", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 100_000_000,
    positions: [
      { ticker: "AAA", openQty: 100, currentPriceKvnd: 10 },
      { ticker: "BBB", openQty: 200, currentPriceKvnd: 20 },
    ],
    activeRiskRows: [
      { tradeId: "a1", ticker: "AAA", activeRiskVnd: 1_000_000, riskStatus: "known" },
      { tradeId: "a2", ticker: "AAA", activeRiskVnd: 2_000_000, riskStatus: "known" },
    ],
    sectors: [sector("AAA", "Ngân hàng"), sector("BBB", "Công nghệ")],
    rules: rules({ maxConcurrentOpenPositions: 1 }),
    planVersion: 1,
  })

  assert.equal(model.snapshot.tickerKnownActiveRiskVnd.AAA, 3_000_000)
  assert.deepEqual(model.snapshot.openTickers, ["AAA", "BBB"])
  assert.equal(model.summary.openPositionCount, 2)
  assert.equal(model.openPositions.metricValue, 2)
  assert.equal(model.openPositions.status, "BREACH")
})

test("non-positive Account Equity makes percentage checks UNKNOWN instead of fabricating a denominator", async () => {
  const { evaluateCurrentConcentration } = await loadDomain()
  const model = evaluateCurrentConcentration({
    accountEquityVnd: 0,
    positions: [{ ticker: "AAA", openQty: 100, currentPriceKvnd: 10 }],
    activeRiskRows: [{ tradeId: "a1", ticker: "AAA", activeRiskVnd: 1_000_000, riskStatus: "known" }],
    sectors: [sector("AAA", "Ngân hàng")],
    rules: rules({ maxTickerConcentrationPercent: 30, maxSectorRiskPercent: 6 }),
    planVersion: 1,
  })

  assert.equal(model.tickerMarketValue[0]!.metricValue, null)
  assert.equal(model.tickerMarketValue[0]!.status, "UNKNOWN")
  assert.equal(model.sectorActiveRisk[0]!.metricValue, null)
  assert.equal(model.sectorActiveRisk[0]!.status, "UNKNOWN")
})
