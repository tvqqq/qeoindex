import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const evidencePath = path.join(process.cwd(), "modules/portfolio/risk-plan/evidence.ts")

async function loadEvidence() {
  assert.equal(fs.existsSync(evidencePath), true, "QEO-138 evidence.ts must exist")
  return import("../../modules/portfolio/risk-plan/evidence.ts")
}

type Trade = {
  id: string
  ticker: string
  status: "closed" | "open"
  closed_at: string | null
}

type Fill = {
  id: string
  trade_id: string | null
  ticker: string
  action: "buy" | "sell" | "dividend_cash" | "dividend_stock" | "rights"
  quantity: number
  price: number
  fee: number
  transaction_date: string
  tags: string[]
}

const trades: Trade[] = [
  { id: "t1", ticker: "FPT", status: "closed", closed_at: "2026-01-15T08:00:00Z" },
  { id: "t2", ticker: "VIC", status: "closed", closed_at: "2026-03-15T08:00:00Z" },
  { id: "t3", ticker: "MSN", status: "closed", closed_at: "2026-06-15T08:00:00Z" },
]

const fills: Fill[] = [
  // t1: two scale-out fills; one logical winning Trade, +160 before currency scaling.
  { id: "f1", trade_id: "t1", ticker: "FPT", action: "buy", quantity: 100, price: 10, fee: 0, transaction_date: "2026-01-01", tags: [] },
  { id: "f2", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 40, price: 11, fee: 0, transaction_date: "2026-01-10", tags: [] },
  { id: "f3", trade_id: "t1", ticker: "FPT", action: "sell", quantity: 60, price: 12, fee: 0, transaction_date: "2026-01-15", tags: [] },
  // t2: one losing Trade, -100.
  { id: "f4", trade_id: "t2", ticker: "VIC", action: "buy", quantity: 50, price: 20, fee: 0, transaction_date: "2026-03-01", tags: [] },
  { id: "f5", trade_id: "t2", ticker: "VIC", action: "sell", quantity: 50, price: 18, fee: 0, transaction_date: "2026-03-15", tags: [] },
  // t3: one winning Trade, +100.
  { id: "f6", trade_id: "t3", ticker: "MSN", action: "buy", quantity: 100, price: 5, fee: 0, transaction_date: "2026-06-01", tags: [] },
  { id: "f7", trade_id: "t3", ticker: "MSN", action: "sell", quantity: 100, price: 6, fee: 0, transaction_date: "2026-06-15", tags: [] },
  // Legacy ungrouped accounting row must never become a fourth Trade.
  { id: "legacy", trade_id: null, ticker: "HPG", action: "buy", quantity: 1000, price: 25, fee: 0, transaction_date: "2026-02-01", tags: [] },
]

test("Win Ratio and Payoff Ratio use eligible closed logical Trades, not raw fills", async () => {
  const { buildRiskProfileEvidence } = await loadEvidence()
  const evidence = buildRiskProfileEvidence({
    trades,
    fills,
    periodEnd: "2026-09-07T00:00:00Z",
  })

  assert.equal(evidence.winRatio.source, "canonical_closed_trades")
  assert.equal(evidence.winRatio.sampleSize, 3)
  assert.equal(evidence.winRatio.excludedCount, 0)
  assert.equal(evidence.winRatio.completeness, "complete")
  assert.ok(Math.abs((evidence.winRatio.value ?? 0) - (2 / 3) * 100) < 1e-9)

  assert.equal(evidence.payoffRatio.source, "canonical_closed_trades")
  assert.equal(evidence.payoffRatio.sampleSize, 3)
  assert.equal(evidence.payoffRatio.excludedCount, 0)
  assert.equal(evidence.payoffRatio.completeness, "complete")
  assert.ok(Math.abs((evidence.payoffRatio.value ?? 0) - 1.3) < 1e-9)

  assert.equal(evidence.winRatio.periodStart, "2026-01-15T08:00:00Z")
  assert.equal(evidence.winRatio.periodEnd, "2026-09-07T00:00:00Z")
})

test("closed Trades with incomplete linked fills are excluded and make evidence partial", async () => {
  const { buildRiskProfileEvidence } = await loadEvidence()
  const incompleteTrade: Trade = {
    id: "t4",
    ticker: "MWG",
    status: "closed",
    closed_at: "2026-07-20T08:00:00Z",
  }
  const incompleteFill: Fill = {
    id: "f8",
    trade_id: "t4",
    ticker: "MWG",
    action: "buy",
    quantity: 100,
    price: 50,
    fee: 0,
    transaction_date: "2026-07-01",
    tags: [],
  }

  const evidence = buildRiskProfileEvidence({
    trades: [...trades, incompleteTrade],
    fills: [...fills, incompleteFill],
    periodEnd: "2026-09-07T00:00:00Z",
  })

  assert.equal(evidence.winRatio.sampleSize, 3)
  assert.equal(evidence.winRatio.excludedCount, 1)
  assert.equal(evidence.winRatio.completeness, "partial")
  assert.equal(evidence.payoffRatio.completeness, "partial")
})

test("no eligible closed Trade remains explicit insufficient history", async () => {
  const { buildRiskProfileEvidence } = await loadEvidence()
  const evidence = buildRiskProfileEvidence({
    trades: [{ id: "open-1", ticker: "FPT", status: "open", closed_at: null }],
    fills: [{ id: "open-fill", trade_id: "open-1", ticker: "FPT", action: "buy", quantity: 100, price: 10, fee: 0, transaction_date: "2026-09-01", tags: [] }],
    periodEnd: "2026-09-07T00:00:00Z",
  })

  assert.equal(evidence.winRatio.value, null)
  assert.equal(evidence.winRatio.sampleSize, 0)
  assert.equal(evidence.winRatio.completeness, "insufficient")
  assert.equal(evidence.payoffRatio.value, null)
  assert.equal(evidence.payoffRatio.completeness, "insufficient")
})

test("Payoff Ratio with no losing Trade is insufficient instead of Infinity", async () => {
  const { buildRiskProfileEvidence } = await loadEvidence()
  const winningTrades = trades.filter((trade) => trade.id !== "t2")
  const winningFills = fills.filter((fill) => fill.trade_id !== "t2")

  const evidence = buildRiskProfileEvidence({
    trades: winningTrades,
    fills: winningFills,
    periodEnd: "2026-09-07T00:00:00Z",
  })

  assert.equal(evidence.winRatio.value, 100)
  assert.equal(evidence.winRatio.completeness, "complete")
  assert.equal(evidence.payoffRatio.value, null)
  assert.equal(evidence.payoffRatio.completeness, "insufficient")
  assert.match(evidence.payoffRatio.note ?? "", /losing Trade/i)
})

test("12-month active trading return stays unavailable without canonical equity history", async () => {
  const { buildRiskProfileEvidence } = await loadEvidence()
  const evidence = buildRiskProfileEvidence({
    trades,
    fills,
    periodEnd: "2026-09-07T00:00:00Z",
  })

  assert.equal(evidence.activeReturn12m.source, "unavailable")
  assert.equal(evidence.activeReturn12m.value, null)
  assert.equal(evidence.activeReturn12m.completeness, "insufficient")
  assert.equal(evidence.activeReturn12m.periodStart, "2025-09-07T00:00:00.000Z")
  assert.equal(evidence.activeReturn12m.periodEnd, "2026-09-07T00:00:00Z")
  assert.match(evidence.activeReturn12m.note ?? "", /Account Equity/i)
})
