import test from "node:test"
import assert from "node:assert/strict"

import { getMarketBaselineCached, getEodReferencePricesCached, type MarketBaseline, type EodReferenceMap } from "../lib/market-baseline-cache.ts"

test("getMarketBaselineCached executes loader on cache miss and returns valid baseline", async () => {
  const date = "2026-08-18"
  let loaded = false

  const result = await getMarketBaselineCached(date, async (): Promise<MarketBaseline> => {
    loaded = true
    return {
      date,
      vnindexPriorVolume: 550_000_000,
      vnindexPriorValue: 14_800_000_000_000,
      advances: 130,
      declines: 160,
      unchanged: 70,
      generatedAt: new Date().toISOString(),
    }
  })

  assert.equal(loaded, true)
  assert.equal(result.date, date)
  assert.equal(result.vnindexPriorVolume, 550_000_000)
  assert.equal(result.advances, 130)
})

test("getEodReferencePricesCached executes loader on cache miss and returns reference map", async () => {
  const date = "2026-08-18"
  let loaded = false

  const result = await getEodReferencePricesCached(date, async (): Promise<EodReferenceMap> => {
    loaded = true
    return {
      date,
      references: {
        HPG: { reference: 28.5, ceiling: 30.45, floor: 26.55, lastClose: 28.5 },
        SSI: { reference: 34.2, ceiling: 36.55, floor: 31.85, lastClose: 34.2 },
      },
      generatedAt: new Date().toISOString(),
    }
  })

  assert.equal(loaded, true)
  assert.equal(result.date, date)
  assert.equal(result.references.HPG.reference, 28.5)
  assert.equal(result.references.SSI.reference, 34.2)
})
