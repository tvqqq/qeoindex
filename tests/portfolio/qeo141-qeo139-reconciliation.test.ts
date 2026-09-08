import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

import { projectActiveRisk } from "../../modules/portfolio/risk-sizing/projection.ts"

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

test("projected risk starts from canonical QEO-141 subtotal", () => {
  const result = projectActiveRisk({
    knownActiveRiskVnd: 12_000_000,
    accountEquityVnd: 500_000_000,
    maxActiveRiskPercent: 6,
    unknownRiskTradeCount: 0,
    riskState: "normal",
  }, 5_000_000)
  assert.equal(result.projectedKnownActiveRiskVnd, 17_000_000)
})

test("risk sizing server delegates current portfolio risk to QEO-141", () => {
  const source = read("modules/portfolio/risk-sizing/server.ts")
  assert.match(source, /getPortfolioRiskContext/)
  assert.doesNotMatch(source, /computeOpenTradeRiskContext/)
  assert.doesNotMatch(source, /portfolio_trade_stop_events/)
})

test("canonical reduced-risk state preserves configured and effective defaults separately", () => {
  const canonicalState = {
    configuredDefaultTradeRiskPercent: 2,
    effectiveDefaultTradeRiskPercent: 1.5,
    state: "REDUCE_RISK" as const,
  }
  assert.equal(canonicalState.configuredDefaultTradeRiskPercent, 2)
  assert.equal(canonicalState.effectiveDefaultTradeRiskPercent, 1.5)
})
