import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import { fetchYahooDailyOhlcv } from "../modules/market/providers/yahoo/history.ts"

function approx(actual: number, expected: number, epsilon = 0.0051) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`)
}

test("QEO-106 Yahoo Daily applies adjusted-close ratio to OHLC while preserving volume", async () => {
  const originalFetch = globalThis.fetch
  const sourceTime = 1_740_355_200 // 2025-02-24 UTC
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [sourceTime],
        indicators: {
          quote: [{
            open: [93.3],
            high: [93.5],
            low: [92.7],
            close: [93.5],
            volume: [1_956_000],
          }],
          adjclose: [{ adjclose: [61.64] }],
        },
        meta: { previousClose: 93.1 },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })

  try {
    const bars = await fetchYahooDailyOhlcv("VCB", new Date("2025-02-25T16:00:00+07:00"), 10)
    assert.equal(bars.length, 1)
    const bar = bars[0]
    const ratio = 61.64 / 93.5
    approx(bar.open, 93.3 * ratio)
    approx(bar.high, 93.5 * ratio)
    approx(bar.low, 92.7 * ratio)
    approx(bar.close, 61.64)
    assert.equal(bar.volume, 1_956_000)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("QEO-106 repair worker treats legacy raw Yahoo Daily rows as suspect and refetches through provider priority", () => {
  const integrity = readFileSync(new URL("../modules/market/history/daily-integrity.ts", import.meta.url), "utf8")
  assert.match(integrity, /loadLegacyYahooBasisRows/)
  assert.match(integrity, /legacyYahooRowsByTicker/)
  assert.match(integrity, /legacyYahooDates/)
  assert.match(integrity, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\//)
  assert.match(integrity, /\.eq\("provider", "Fallback"\)/)
  assert.match(integrity, /provider_detail/)
  assert.match(integrity, /fetchDailyMarketHistoryWindow/)
  assert.match(integrity, /\.\.\.legacyYahooDates/)
})

test("QEO-106 partial provider windows fall back per unresolved trading session", () => {
  const integrity = readFileSync(new URL("../modules/market/history/daily-integrity.ts", import.meta.url), "utf8")
  assert.match(integrity, /for \(const sessionDate of unresolvedSessions\)/)
  assert.match(integrity, /fetchDailyMarketHistoryWindow\([\s\S]*?\(_provider, bar\) => vietnamDateKey\(bar\.time \* 1000\) === sessionDate/)
  assert.match(integrity, /QEO-106 per-session Daily integrity repair/)
})

test("QEO-106 semantic basis repair can replace legacy Yahoo rows and counts only persisted dates", () => {
  const migrationDirs = [
    new URL("../supabase/migrations/", import.meta.url),
    new URL("../supabase/pending-migrations/", import.meta.url),
  ]
  const migrationSources = migrationDirs.flatMap((dir) => readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(new URL(name, dir), "utf8")))
  const semanticPrecedence = migrationSources.find((source) => source.includes("QEO-106 semantic Daily basis precedence"))
  assert.ok(semanticPrecedence, "expected a QEO-106 semantic basis precedence migration")
  assert.match(semanticPrecedence, /old_semantic_valid/)
  assert.match(semanticPrecedence, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\//)
  assert.match(semanticPrecedence, /adjusted OHLC/i)
  assert.match(semanticPrecedence, /not old_semantic_valid and new_valid/)

  const integrity = readFileSync(new URL("../modules/market/history/daily-integrity.ts", import.meta.url), "utf8")
  assert.match(integrity, /verifyPersistedRepairDates/)
  assert.match(integrity, /persistedDates/)
  assert.match(integrity, /QEO-106 repair readback/)
})
