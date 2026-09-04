import assert from "node:assert/strict"
import test from "node:test"

import { extractPortfolioMarketPrices } from "../modules/portfolio/market-prices.ts"

test("portfolio prices follow the intraday histories contract", () => {
  assert.deepEqual(extractPortfolioMarketPrices({
    histories: {
      FPT: { price: 142.5, points: [{ close: 141 }] },
      VCB: { price: null, points: [{ close: 92.3 }] },
      BAD: { price: 0, points: [] },
    },
  }), { FPT: 142.5, VCB: 92.3 })
})

test("portfolio prices fail closed for missing or invalid payloads", () => {
  assert.deepEqual(extractPortfolioMarketPrices(null), {})
  assert.deepEqual(extractPortfolioMarketPrices({ histories: { FPT: { price: Number.NaN } } }), {})
})
