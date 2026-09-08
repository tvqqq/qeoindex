import assert from "node:assert/strict"
import test from "node:test"

import { derivePortfolioRiskState } from "../../modules/portfolio/risk-engine/risk-state.ts"

const pauseRule = {
  ruleId: "drawdown_pause",
  severity: "pause" as const,
  configuredThreshold: 15,
  observedValue: 16,
  status: "triggered" as const,
  reason: "Drawdown 16% >= 15%",
  source: "account_equity" as const,
}
const reduceRule = {
  ruleId: "drawdown_reduce",
  severity: "reduce" as const,
  configuredThreshold: 10,
  observedValue: 11,
  status: "triggered" as const,
  reason: "Drawdown 11% >= 10%",
  source: "account_equity" as const,
}
const insufficientRule = {
  ruleId: "rolling_loss",
  severity: "pause" as const,
  configuredThreshold: 25,
  observedValue: null,
  status: "insufficient" as const,
  reason: "Need 25 closed Trades",
  source: "canonical_closed_trades" as const,
}
const clearRule = {
  ...reduceRule,
  observedValue: 3,
  status: "clear" as const,
  reason: "Drawdown 3% < 10%",
}

test("known PAUSE beats REDUCE and insufficient evidence", () => {
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: 0.5,
    rules: [pauseRule, reduceRule, insufficientRule],
  })
  assert.equal(result.state, "PAUSE_AND_REVIEW")
  assert.deepEqual(result.triggers.map((rule) => rule.ruleId), ["drawdown_pause", "drawdown_reduce"])
})

test("REDUCE applies configured factor", () => {
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: 0.75,
    rules: [reduceRule],
  })
  assert.equal(result.state, "REDUCE_RISK")
  assert.equal(result.effectiveDefaultTradeRiskPercent, 1.5)
})

test("insufficient evidence yields UNKNOWN without stronger trigger", () => {
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: null,
    rules: [insufficientRule],
  })
  assert.equal(result.state, "UNKNOWN")
  assert.deepEqual(result.insufficientRules.map((rule) => rule.ruleId), ["rolling_loss"])
})

test("clear rules recover deterministically to NORMAL", () => {
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: 0.75,
    rules: [clearRule],
  })
  assert.equal(result.state, "NORMAL")
  assert.equal(result.effectiveDefaultTradeRiskPercent, 2)
})

test("cap-only REDUCE without valid factor does not invent one", () => {
  const capRule = {
    ruleId: "active_risk_cap",
    severity: "reduce" as const,
    configuredThreshold: 6,
    observedValue: 7,
    status: "triggered" as const,
    reason: "Known Active Risk 7% > 6%",
    source: "active_risk" as const,
  }
  const result = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent: 2,
    reductionFactor: null,
    rules: [capRule],
  })
  assert.equal(result.state, "REDUCE_RISK")
  assert.equal(result.effectiveDefaultTradeRiskPercent, 2)
})
