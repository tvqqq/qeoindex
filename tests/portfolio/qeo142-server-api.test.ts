import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

test("performance server owns authenticated canonical evidence assembly", () => {
  const server = read("modules/portfolio/performance/server.ts")

  assert.match(server, /export async function getPortfolioPerformanceContext/)
  for (const table of [
    "portfolios",
    "portfolio_transactions",
    "portfolio_trades",
    "portfolio_trade_journal_entries",
    "portfolio_trade_stop_events",
    "portfolio_trade_stop_exit_fills",
    "market_ohlcv_raw_daily",
  ]) {
    assert.match(server, new RegExp(table))
  }
  for (const owner of [
    "buildEquityCurve",
    "deriveClosedTradeOutcomes",
    "buildTradingScorecard",
    "deriveDrawdownAnalytics",
    "buildTradingLedgers",
    "buildAccountLedgers",
    "buildPerformanceSegments",
    "buildBenchmarkComparison",
  ]) {
    assert.match(server, new RegExp(owner))
  }
  assert.match(server, /price_basis/)
  assert.match(server, /RAW/)
  assert.match(server, /VND_THOUSANDS/)
  assert.match(server, /fetchDnseIndexCandleHistory|VNINDEX/)
  assert.doesNotMatch(server, /realized\s*\/\s*totalBasis|investedCapital/)
})

test("performance route is authenticated no-store read-only and delegates", () => {
  const route = read("app/api/portfolio/[id]/performance/route.ts")

  assert.match(route, /requireApiUser\(\)/)
  assert.match(route, /getPortfolioPerformanceContext/)
  assert.match(route, /runtime = "nodejs"/)
  assert.match(route, /dynamic = "force-dynamic"/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /\.from\(/)
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/)
})
