import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { missingTradingProviderRanges } from "../../modules/market/chart-data/provider-coverage.ts"
import { overlayHourlyHotOnDerived } from "../../modules/market/chart-data/timeframes.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

function epoch(value: string) {
  return Math.floor(new Date(value).getTime() / 1000)
}

test("QEO-172 partial old-range reads reuse only positively-ready existing derived manifests", () => {
  const readyRange = source("modules/market/chart-data/derived-hourly-ready-range.ts")
  const timeframe = source("modules/market/chart-data/timeframe-service.ts")

  assert.match(readyRange, /export async function derivedHourlyExistingManifestsReady/)
  assert.match(readyRange, /readReadyDerivedHourlyRange[\s\S]*?listExistingManifests/)
  assert.match(readyRange, /readReadyDerivedHourlyRange[\s\S]*?\.in\("source_manifest_id",\s*ids\)/)
  assert.match(readyRange, /readReadyDerivedHourlyRange[\s\S]*?validateDerivedHourlyManifestReadiness/)
  assert.match(readyRange, /postRead[\s\S]*?ready !== true/)

  assert.match(timeframe, /derivedHourlyExistingManifestsReady/)
  assert.match(timeframe, /readReadyDerivedHourlyRange/)
  assert.match(timeframe, /const derivedCoverage:[\s\S]*?derivedHourlyExistingManifestsReady/)

  const hourlyStart = timeframe.indexOf("async function loadHourlyFamily")
  const hourlyEnd = timeframe.indexOf("export async function getChartOhlcv", hourlyStart)
  const hourly = timeframe.slice(hourlyStart, hourlyEnd)
  const sourceCoverageCheck = hourly.indexOf("oldSourceCoverageComplete = await measured")
  const cacheReadinessCheck = hourly.indexOf("cacheReady = await measured")
  assert.ok(sourceCoverageCheck >= 0, "full source coverage must remain an independent truthfulness proof")
  assert.ok(cacheReadinessCheck >= 0, "existing derived-manifest readiness must still be checked fail-closed")
  assert.ok(sourceCoverageCheck < cacheReadinessCheck, "freeze source completeness before serving a partial derived snapshot")
  assert.match(hourly, /oldCoverageProven:\s*oldSourceCoverageComplete/)
})

test("QEO-172 full derived coverage still requires every requested trading session to have verified RAW", () => {
  const store = source("modules/market/chart-data/derived-hourly-store.ts")
  assert.match(store, /derivedHourlyColdCoverageComplete[\s\S]*?requiredTradingDates/)
  assert.match(store, /requiredDates\.some\(\(dateKey\) => !datesWithManifest\.has\(dateKey\)\)/)
  assert.match(store, /derivedHourlyColdCoverageComplete[\s\S]*?validateDerivedHourlyManifestReadiness/)
})

test("QEO-172 hourly source proof accepts durable HOT success while archive lags and stays fail-closed on partial coverage", () => {
  const request = {
    from: epoch("2026-09-07T09:00:00+07:00"),
    to: epoch("2026-09-07T14:46:00+07:00"),
  }
  const fullDurableSuccess = [{ ...request }]
  const partialDurableSuccess = [{
    from: request.from,
    to: epoch("2026-09-07T11:30:00+07:00"),
  }]

  assert.deepEqual(missingTradingProviderRanges(request, fullDurableSuccess), [])
  assert.ok(missingTradingProviderRanges(request, partialDurableSuccess).length > 0)

  const coverage = source("modules/market/chart-data/derived-hourly-source-coverage.ts")
  assert.match(coverage, /readProviderRequestCoverage/)
  assert.match(coverage, /missingTradingProviderRanges/)
  assert.match(coverage, /datesWithManifest/)
})

test("QEO-172 authoritative HOT-only hour fills an unarchived derived gap without requiring COLD overlap", () => {
  const derived = [{
    time: epoch("2026-09-04T09:00:00+07:00"),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
  }]
  const hot = [
    { time: epoch("2026-09-07T09:15:00+07:00"), open: 110, high: 111, low: 109, close: 110.5, volume: 10 },
    { time: epoch("2026-09-07T09:16:00+07:00"), open: 110.5, high: 112, low: 110, close: 111.5, volume: 20 },
  ]

  const overlay = overlayHourlyHotOnDerived({
    derived,
    cold: [],
    hot,
    allowHotOnlyBuckets: true,
  })

  assert.equal(overlay.unresolvedHotOverlap, false)
  assert.equal(overlay.bars.length, 2)
  assert.deepEqual(overlay.bars[1], {
    time: epoch("2026-09-07T09:00:00+07:00"),
    open: 110,
    high: 112,
    low: 109,
    close: 111.5,
    volume: 30,
  })
})

test("QEO-172 HOT without COLD never replaces an existing derived bucket even with source coverage proof", () => {
  const derived = [{
    time: epoch("2026-09-07T09:00:00+07:00"),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
  }]
  const hot = [
    { time: epoch("2026-09-07T09:15:00+07:00"), open: 110, high: 111, low: 109, close: 110.5, volume: 10 },
  ]

  const overlay = overlayHourlyHotOnDerived({
    derived,
    cold: [],
    hot,
    allowHotOnlyBuckets: true,
  })

  assert.equal(overlay.unresolvedHotOverlap, true)
  assert.deepEqual(overlay.bars, derived)
})
