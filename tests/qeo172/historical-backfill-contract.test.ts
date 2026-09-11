import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 historical recovery backfills bounded verified RAW chunks without weakening chart completeness", () => {
  const routeUrl = new URL("../../app/api/qeoindex/chart-history-backfill/route.ts", import.meta.url)
  assert.equal(existsSync(routeUrl), true, "machine-authenticated historical backfill route must exist")

  const bootstrap = source("modules/market/chart-data/bootstrap.ts")
  const route = readFileSync(routeUrl, "utf8")

  assert.match(bootstrap, /export async function backfillChartIntradayHistoricalChunk/)
  assert.match(bootstrap, /31\s*\*\s*(?:DAY_SECONDS|86_400)/)
  assert.match(bootstrap, /chartHotSessionRetentionCutoff/)
  assert.match(bootstrap, /executeBootstrapChunkWork/)
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /searchParams\.get\("ticker"\)/)
  assert.match(route, /searchParams\.get\("from"\)/)
  assert.match(route, /searchParams\.get\("to"\)/)
  assert.match(route, /backfillChartIntradayHistoricalChunk/)
})
