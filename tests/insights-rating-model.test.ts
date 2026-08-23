import assert from "node:assert/strict"
import test from "node:test"

import { calculateRatingModel, historyDelta, type RatingModelSnapshot } from "../lib/insights-rating-model.ts"

const base: RatingModelSnapshot = {
  asOfDate: "2026-08-23", ratingScore: 78, score4m: 76, canslimScore: 82,
  pricePotential: "Tăng ↑↑", rsShort: 72, rsMedium: 70,
  stockRrgState: "Dẫn dắt", sectorRrgState: "Dẫn dắt", rsi14: 56,
  weeklyChangePercent: 2.4, monthlyChangePercent: 7.2, beta: 0.9,
}

test("rating model identifies controlled accumulation", () => {
  const result = calculateRatingModel({ ...base, weeklyChangePercent: 0.5, monthlyChangePercent: 2, rsi14: 50 })
  assert.ok(result.dimensions.every((item) => item.score >= 0 && item.score <= 100))
  assert.ok(["Tích lũy kín", "Tích lũy", "Dẫn dắt"].includes(result.state))
})

test("rating model flags high downside risk", () => {
  const result = calculateRatingModel({ ...base, ratingScore: 25, beta: 1.8, weeklyChangePercent: -13, monthlyChangePercent: -28, stockRrgState: "Đội sổ" })
  assert.equal(result.state, "Rủi ro cao")
})

test("history delta uses the latest snapshot on or before target day", () => {
  const history = [base, { ...base, asOfDate: "2026-08-16", ratingScore: 70 }, { ...base, asOfDate: "2026-08-15", ratingScore: 65 }]
  assert.equal(historyDelta(78, history, 7, (item) => item.ratingScore), 8)
  assert.equal(historyDelta(78, history, 30, (item) => item.ratingScore), null)
})
