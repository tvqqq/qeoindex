import test from "node:test"
import assert from "node:assert/strict"
import {
  previousTradingSessionDateKey,
  vietnamSessionMinute,
  observedValueAtMinute,
  intradayForeignNet,
} from "../modules/market/board/market-context-metrics.ts"

test("HOSE liquidity reference uses only the immediately prior securities trading date", () => {
  assert.equal(previousTradingSessionDateKey("2026-10-06"), "2026-10-05")
  assert.equal(previousTradingSessionDateKey("2026-08-24"), "2026-08-21")
  assert.equal(previousTradingSessionDateKey("2026-09-03"), "2026-08-28")
  assert.equal(previousTradingSessionDateKey(""), null)
  assert.equal(previousTradingSessionDateKey("bad-date"), null)
})

test("intraday value comparison aligns Vietnam-local minutes and does not extrapolate missing hours", () => {
  const points = [
    { minute: Date.parse("2026-10-05T02:00:00Z"), value: 50_000_000_000 },
    { minute: Date.parse("2026-10-05T02:30:00Z"), value: 150_000_000_000 },
    { minute: Date.parse("2026-10-05T03:00:00Z"), value: 250_000_000_000 },
  ]
  assert.equal(vietnamSessionMinute(points[1].minute), 570)
  assert.equal(observedValueAtMinute(points, 540), 50_000_000_000)
  assert.equal(observedValueAtMinute(points, 580), 150_000_000_000)
  assert.equal(observedValueAtMinute(points, 539), undefined)
  assert.equal(observedValueAtMinute(points, 630), undefined)
  assert.equal(observedValueAtMinute([], 570), undefined)
})

test("foreign net intraday uses signed cumulative buy minus sell and keeps verified zero", () => {
  const net = intradayForeignNet([
    { minute: 1, buy: 100, sell: 70 },
    { minute: 2, buy: 100, sell: 100 },
    { minute: 3, buy: 100, sell: 130 },
    { minute: 4, buy: Number.NaN, sell: 100 },
  ])
  assert.deepEqual(net, [
    { minute: 1, value: 30 },
    { minute: 2, value: 0 },
    { minute: 3, value: -30 },
  ])
})
