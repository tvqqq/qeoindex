import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

test("portfolio risk server owns authenticated canonical evidence assembly", () => {
  const server = read("modules/portfolio/risk-engine/server.ts")

  assert.match(server, /export async function getPortfolioRiskContext/)
  for (const table of [
    "portfolio_transactions",
    "portfolio_trades",
    "portfolio_trade_stop_events",
    "portfolio_trade_stop_exit_fills",
    "market_ohlcv_raw_daily",
  ]) {
    assert.match(server, new RegExp(table))
  }
  assert.match(server, /getRiskPlanOverview/)
  assert.match(server, /getCachedIntraday5mSnapshot|getIntraday5mSnapshot/)
  assert.match(server, /computeOpenTradeActiveRisk/)
  assert.match(server, /buildCurrentAccountEquity/)
  assert.match(server, /buildEquityCurve/)
  assert.match(server, /deriveGuardrailTradeOutcomes/)
  assert.match(server, /derivePortfolioRiskState/)
  assert.match(server, /price_basis/)
  assert.match(server, /VND_THOUSANDS/)
  assert.doesNotMatch(server, /stop_loss_1|stop_loss_2|stop_loss_3/)
})

test("portfolio risk route is authenticated, no-store, read-only and delegates to server", () => {
  const route = read("app/api/portfolio/[id]/risk/route.ts")

  assert.match(route, /requireApiUser\(\)/)
  assert.match(route, /getPortfolioRiskContext/)
  assert.match(route, /runtime = "nodejs"/)
  assert.match(route, /dynamic = "force-dynamic"/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /\.from\(/)
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/)
})
