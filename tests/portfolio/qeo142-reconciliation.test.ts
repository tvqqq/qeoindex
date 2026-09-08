import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

import { deriveClosedTradeOutcomes } from "../../modules/portfolio/performance/closed-trades.ts"
import { buildTradingScorecard } from "../../modules/portfolio/performance/scorecard.ts"
import { buildRiskProfileEvidence } from "../../modules/portfolio/risk-plan/evidence.ts"

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8")
}

const trades = [
  { id: "t1", ticker: "FPT", mode: "live" as const, status: "closed", timeframe: "swing", system_tags: ["trend"], setup_tags: ["breakout"], initial_risk_amount: null, closed_at: "2026-01-15T08:00:00Z" },
  { id: "t2", ticker: "VIC", mode: "paper" as const, status: "closed", timeframe: "position", system_tags: [], setup_tags: [], initial_risk_amount: null, closed_at: "2026-03-15T08:00:00Z" },
  { id: "t3", ticker: "MSN", mode: "live" as const, status: "closed", timeframe: "swing", system_tags: [], setup_tags: [], initial_risk_amount: null, closed_at: "2026-06-15T08:00:00Z" },
]

const fills = [
  { id: "f1", trade_id: "t1", ticker: "FPT", action: "buy" as const, quantity: 100, price: 10, fee: 0, transaction_date: "2026-01-01", tags: [] },
  { id: "f2", trade_id: "t1", ticker: "FPT", action: "sell" as const, quantity: 100, price: 12, fee: 0, transaction_date: "2026-01-15", tags: [] },
  { id: "f3", trade_id: "t2", ticker: "VIC", action: "buy" as const, quantity: 100, price: 20, fee: 0, transaction_date: "2026-03-01", tags: [] },
  { id: "f4", trade_id: "t2", ticker: "VIC", action: "sell" as const, quantity: 100, price: 19, fee: 0, transaction_date: "2026-03-15", tags: [] },
  { id: "f5", trade_id: "t3", ticker: "MSN", action: "buy" as const, quantity: 100, price: 5, fee: 0, transaction_date: "2026-06-01", tags: [] },
  { id: "f6", trade_id: "t3", ticker: "MSN", action: "sell" as const, quantity: 100, price: 6, fee: 0, transaction_date: "2026-06-15", tags: [] },
]

test("QEO-138 Win and Payoff evidence reconcile exactly with canonical Scorecard core", () => {
  const periodEnd = "2026-09-08T00:00:00Z"
  const evidence = buildRiskProfileEvidence({ trades, fills, periodEnd, computedAt: periodEnd })
  const normalized = deriveClosedTradeOutcomes({ trades, fills })
  const scorecard = buildTradingScorecard({
    outcomes: normalized.outcomes,
    population: "combined",
    initialCapitalVnd: null,
  })

  assert.equal(evidence.winRatio.value, scorecard.winRatioPercent.value)
  assert.equal(evidence.payoffRatio.value, scorecard.payoffRatio.value)
  assert.equal(evidence.winRatio.sampleSize, scorecard.eligibleTradeCount)
  assert.equal(evidence.payoffRatio.sampleSize, scorecard.eligibleTradeCount)
})

test("QEO-138 evidence delegates closed Trade and Scorecard arithmetic to performance owners", () => {
  const source = read("modules/portfolio/risk-plan/evidence.ts")
  assert.match(source, /deriveClosedTradeOutcomes/)
  assert.match(source, /buildTradingScorecard/)
  assert.match(source, /population:\s*["']combined["']/)
  assert.doesNotMatch(source, /computePortfolioPositions/)
  assert.doesNotMatch(source, /function arithmeticMean/)
})

test("QEO-138 server loads canonical Trade metadata instead of fabricating mode", () => {
  const source = read("modules/portfolio/risk-plan/server.ts")
  assert.match(source, /id,ticker,mode,status,timeframe,system_tags,setup_tags,initial_risk_amount,closed_at/)
  assert.match(source, /setup_tags,mistake_tags/)
})

test("legacy benchmark endpoint is only a compatibility adapter over canonical performance", () => {
  const source = read("app/api/portfolio/[id]/benchmark/route.ts")
  assert.match(source, /getPortfolioPerformanceContext/)
  assert.match(source, /performance\.benchmark/)
  assert.doesNotMatch(source, /computePortfolioPositions/)
  assert.doesNotMatch(source, /fetchDnseIndexCandleHistory/)
  assert.doesNotMatch(source, /\.from\(/)
  assert.doesNotMatch(source, /investedCapital|totalBasis|realized\s*\//)
})
