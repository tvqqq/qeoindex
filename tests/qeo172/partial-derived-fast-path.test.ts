import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 partial old-range reads reuse only positively-ready existing derived manifests", () => {
  const store = source("modules/market/chart-data/derived-hourly-store.ts")
  const timeframe = source("modules/market/chart-data/timeframe-service.ts")

  assert.match(store, /export async function derivedHourlyExistingManifestsReady/)
  assert.match(store, /readDerivedHourlyRange[\s\S]*?listVerifiedColdManifests/)
  assert.match(store, /readDerivedHourlyRange[\s\S]*?\.in\("source_manifest_id",\s*manifestIds\)/)
  assert.match(store, /readDerivedHourlyRange[\s\S]*?validateDerivedHourlyManifestReadiness/)

  assert.match(timeframe, /derivedHourlyExistingManifestsReady/)
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
  assert.match(store, /derivedHourlyColdCoverageComplete[\s\S]*?derivedHourlyExistingManifestsReady/)
})
