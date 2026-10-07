import test from "node:test"
import assert from "node:assert/strict"
import {
  previousTradingSessionDateKey,
  vietnamSessionMinute,
  observedValueAtMinute,
  observedAreaPaths,
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
  assert.equal(observedValueAtMinute(points, 580, 3), undefined) // stale through an outage
  assert.equal(observedValueAtMinute(points, 572, 3), 150_000_000_000)
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

test("compact HOSE area uses continuous lines through only actual provider observations", () => {
  const pointAt = (time: string, value: number) => ({
    minute: Date.parse(`2026-10-07T${time}:00+07:00`),
    value,
  })
  const observed = [pointAt("13:02", 40), pointAt("09:15", 10), pointAt("09:41", 30)]
  const shape = observedAreaPaths(observed, (minute) => minute - 540, (value) => 100 - value, 100)
  // The 09:41 → 13:02 gap is connected visually without adding invented
  // timestamps or continuing the shape to the 15:00 market boundary.
  assert.equal(shape.line, "M15.0,90.0 L41.0,70.0 L242.0,60.0")
  assert.equal(shape.area, "M15.0,90.0 L41.0,70.0 L242.0,60.0 L242.0,100.0 L15.0,100.0 Z")
  assert.equal((shape.line.match(/M/g) ?? []).length, 1)
  assert.equal((shape.line.match(/[ML]/g) ?? []).length, observed.length)
})

test("signed foreign flow shades to zero; a single dot has no fabricated filled region", () => {
  const first = { minute: Date.parse("2026-10-07T09:15:00+07:00"), value: -20 }
  const second = { minute: Date.parse("2026-10-07T09:22:00+07:00"), value: 15 }
  const x = (minute: number) => minute - 540
  const y = (value: number) => 100 - value
  const signed = observedAreaPaths([first, second], x, y, y(0))
  assert.equal(signed.line, "M15.0,120.0 L22.0,85.0")
  assert.equal(signed.area, "M15.0,120.0 L22.0,85.0 L22.0,100.0 L15.0,100.0 Z")
  assert.deepEqual(observedAreaPaths([first], x, y, 100), { line: "M15.0,120.0", area: "" })
  assert.deepEqual(observedAreaPaths([], x, y, 100), { line: "", area: "" })
  assert.deepEqual(observedAreaPaths([{ minute: NaN, value: 10 }], x, y, 100), { line: "", area: "" })
})
