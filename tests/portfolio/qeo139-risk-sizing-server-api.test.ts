import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const activeRiskPath = path.join(process.cwd(), "modules/portfolio/risk-sizing/active-risk.ts")

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

test("risk-sizing server and route are ownership-scoped and read-only", () => {
  const server = read("modules/portfolio/risk-sizing/server.ts")
  const route = read("app/api/portfolio/[id]/risk-sizing/route.ts")

  assert.match(server, /export async function getRiskSizingContext/)
  assert.match(server, /getRiskPlanOverview/)
  assert.match(server, /\.eq\("portfolio_id", portfolioId\)/)
  assert.match(server, /\.eq\("user_id", context\.user\.id\)/)
  assert.match(server, /\.in\("status", \["open", "partially_closed"\]\)/)
  assert.match(server, /openTradeRisks/)
  assert.doesNotMatch(server, /\.(?:insert|update|delete|upsert)\(/)

  assert.match(route, /requireApiUser\(\)/)
  assert.match(route, /getRiskSizingContext/)
  assert.match(route, /runtime = "nodejs"/)
  assert.match(route, /dynamic = "force-dynamic"/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.doesNotMatch(route, /\.from\(/)
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/)
})

test("active-risk adapter delegates to canonical Trade read model and AVCO accounting", () => {
  const adapter = read("modules/portfolio/risk-sizing/active-risk.ts")
  const canonical = read("modules/portfolio/risk-engine/active-risk.ts")

  assert.match(adapter, /computeOpenTradeActiveRisk/)
  assert.doesNotMatch(adapter, /Math\.max\(0,\s*position\.avgCost/)

  assert.match(canonical, /buildTradeReadModel/)
  assert.match(canonical, /computePortfolioPositions/)
  assert.match(canonical, /fill\.trade_id === trade\.id/)
  assert.doesNotMatch(canonical, /stop_loss_1|stop_loss_2|stop_loss_3/)
})

test("known Active Risk exposes per-Trade breakdown from the same aggregate pass and keeps missing stop risk unknown", async () => {
  assert.equal(fs.existsSync(activeRiskPath), true, "active-risk.ts must exist")
  const { computeOpenTradeRiskContext } = await import("../../modules/portfolio/risk-sizing/active-risk.ts")

  const trades = [
    {
      id: "t1", portfolio_id: "p", user_id: "u", ticker: "FPT", mode: "live" as const, status: "open" as const,
      initial_stop_loss_exit: 95, opened_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "t2", portfolio_id: "p", user_id: "u", ticker: "VIC", mode: "live" as const, status: "open" as const,
      initial_stop_loss_exit: null, opened_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    },
  ]
  const fills = [
    { id: "f1", trade_id: "t1", ticker: "FPT", action: "buy" as const, quantity: 1000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] },
    { id: "f2", trade_id: "t2", ticker: "VIC", action: "buy" as const, quantity: 100, price: 80, fee: 0, transaction_date: "2026-09-01", tags: [] },
    { id: "legacy", trade_id: null, ticker: "HPG", action: "buy" as const, quantity: 9999, price: 20, fee: 0, transaction_date: "2026-09-01", tags: [] },
  ]

  const result = computeOpenTradeRiskContext({ trades, fills, stopEvents: [] })
  assert.equal(result.knownActiveRiskVnd, 5_000_000)
  assert.equal(result.unknownRiskTradeCount, 1)
  assert.deepEqual(result.breakdown.map((row) => row.riskStatus), ["known", "unknown"])
  assert.deepEqual(result.breakdown.map((row) => row.ticker), ["FPT", "VIC"])
  assert.equal(result.breakdown[0]?.openQty, 1000)
  assert.equal(result.breakdown[0]?.avgCostKvnd, 100)
  assert.equal(result.breakdown[0]?.latestStopKvnd, 95)
  assert.equal(result.breakdown[0]?.activeRiskVnd, 5_000_000)
  assert.equal(result.breakdown[1]?.activeRiskVnd, null)
  assert.equal(
    result.breakdown.reduce((sum, row) => sum + (row.activeRiskVnd ?? 0), 0),
    result.knownActiveRiskVnd,
  )
})

test("trailing stop above average entry reduces known downside Trade Risk to zero", async () => {
  const { computeOpenTradeRiskContext } = await import("../../modules/portfolio/risk-sizing/active-risk.ts")
  const trades = [{
    id: "t1", portfolio_id: "p", user_id: "u", ticker: "FPT", mode: "live" as const, status: "partially_closed" as const,
    initial_stop_loss_exit: 95, opened_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  }]
  const fills = [
    { id: "f1", trade_id: "t1", ticker: "FPT", action: "buy" as const, quantity: 1000, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] },
    { id: "f2", trade_id: "t1", ticker: "FPT", action: "sell" as const, quantity: 500, price: 110, fee: 0, transaction_date: "2026-09-03", tags: [] },
  ]
  const stopEvents = [{
    id: "s1", trade_id: "t1", stop_type: "trailing", price: 105, effective_at: "2026-09-04T00:00:00Z", created_at: "2026-09-04T00:00:00Z",
  }]

  const result = computeOpenTradeRiskContext({ trades, fills, stopEvents })
  assert.equal(result.knownActiveRiskVnd, 0)
  assert.equal(result.unknownRiskTradeCount, 0)
})

test("open Trade without sufficient linked fills is Risk Unknown", async () => {
  const { computeOpenTradeRiskContext } = await import("../../modules/portfolio/risk-sizing/active-risk.ts")
  const trades = [{
    id: "t1", portfolio_id: "p", user_id: "u", ticker: "FPT", mode: "paper" as const, status: "open" as const,
    initial_stop_loss_exit: 95, opened_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  }]
  const result = computeOpenTradeRiskContext({ trades, fills: [], stopEvents: [] })
  assert.equal(result.knownActiveRiskVnd, 0)
  assert.equal(result.unknownRiskTradeCount, 1)
})
