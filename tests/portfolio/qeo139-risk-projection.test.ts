import assert from "node:assert/strict"
import test from "node:test"

import { calculateOptimalF } from "../../modules/portfolio/risk-sizing/optimal-f.ts"
import { projectActiveRisk } from "../../modules/portfolio/risk-sizing/projection.ts"
import {
  MCDOWELL_RISK_AMOUNT_FORMULA,
  MCDOWELL_TRADE_SIZE_FORMULA,
  QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA,
  RISK_SIZING_TERMS,
} from "../../modules/portfolio/risk-sizing/terminology.ts"

const base = {
  knownActiveRiskVnd: 10_000_000,
  accountEquityVnd: 500_000_000,
  maxActiveRiskPercent: 6,
  unknownRiskTradeCount: 0,
  riskState: "normal" as const,
}

test("projected Active Risk reports within-plan and breach deterministically", () => {
  const within = projectActiveRisk(base, 5_000_000)
  assert.equal(within.status, "within_plan")
  assert.equal(within.maxActiveRiskVnd, 30_000_000)
  assert.equal(within.projectedKnownActiveRiskVnd, 15_000_000)
  assert.equal(within.remainingRiskBudgetVnd, 15_000_000)

  const breach = projectActiveRisk(base, 25_000_000)
  assert.equal(breach.status, "exceeds_plan")
  assert.equal(breach.projectedKnownActiveRiskVnd, 35_000_000)
  assert.equal(breach.remainingRiskBudgetVnd, 0)
})

test("unknown Trade risk never becomes a within-plan claim", () => {
  const result = projectActiveRisk({ ...base, knownActiveRiskVnd: 0, unknownRiskTradeCount: 1 }, 0)
  assert.equal(result.status, "risk_unknown")
  assert.equal(result.unknownRiskTradeCount, 1)
})

test("missing cap and review states remain explicit", () => {
  assert.equal(projectActiveRisk({ ...base, maxActiveRiskPercent: null }, 1_000_000).status, "no_cap")
  assert.equal(projectActiveRisk({ ...base, riskState: "reduce_risk" }, 1_000_000).status, "review_required")
  assert.equal(projectActiveRisk({ ...base, riskState: "pause_and_review" }, 1_000_000).status, "review_required")
})

test("Optimal f follows McDowell formula and stays unavailable for insufficient evidence", () => {
  const result = calculateOptimalF(60, 2)
  assert.equal(result.status, "available")
  assert.ok(Math.abs((result.value ?? 0) - 0.4) < 1e-12)

  assert.equal(calculateOptimalF(null, 2).status, "insufficient_history")
  assert.equal(calculateOptimalF(60, null).status, "insufficient_history")
  assert.equal(calculateOptimalF(60, 0).status, "invalid")
  assert.equal(calculateOptimalF(101, 2).status, "invalid")
})

test("shared terminology covers every calculator metric with bilingual labels and source classification", () => {
  const required = [
    "accountEquity",
    "riskPerTrade",
    "riskAmount",
    "plannedEntry",
    "initialStop",
    "riskPerShare",
    "estimatedCommission",
    "slippageAllowance",
    "tradeSize",
    "positionValue",
    "activeRisk",
    "maxActiveRisk",
    "remainingRiskBudget",
  ] as const

  for (const key of required) {
    const term = RISK_SIZING_TERMS[key]
    assert.ok(term)
    assert.ok(term.labelVi.length > 0)
    assert.ok(term.labelEn.length > 0)
    assert.ok(term.help.length > 0)
    assert.ok(["book", "product", "extension"].includes(term.sourceKind))
  }

  assert.equal(RISK_SIZING_TERMS.slippageAllowance.sourceKind, "extension")
  assert.equal(RISK_SIZING_TERMS.accountEquity.sourceKind, "product")
  assert.equal(RISK_SIZING_TERMS.activeRisk.sourceKind, "product")
  assert.equal(RISK_SIZING_TERMS.riskAmount.formula, MCDOWELL_RISK_AMOUNT_FORMULA)
  assert.equal(RISK_SIZING_TERMS.tradeSize.formula, QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA)
  assert.match(MCDOWELL_TRADE_SIZE_FORMULA, /Risk Amount.*Commission.*Entry and Stop/i)
})
