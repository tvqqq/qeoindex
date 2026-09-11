import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { uncoveredProviderRanges } from "../../modules/market/chart-data/provider-coverage.ts"

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function serviceSource() {
  return readFileSync(new URL("../../modules/market/chart-data/service.ts", import.meta.url), "utf8")
}

test("QEO-172 successful provider coverage proves an internal sparse minute range is known", () => {
  const sparse = {
    from: epoch("2026-09-08T11:10:00+07:00"),
    to: epoch("2026-09-08T11:13:00+07:00"),
  }

  assert.deepEqual(uncoveredProviderRanges([sparse], [sparse]), [])
})

test("QEO-172 a storage gap without provider coverage remains unresolved", () => {
  const sparse = {
    from: epoch("2026-09-08T11:10:00+07:00"),
    to: epoch("2026-09-08T11:13:00+07:00"),
  }

  assert.deepEqual(uncoveredProviderRanges([sparse], []), [sparse])
})

test("QEO-172 final intraday coverage filters canonical gaps through successful provider coverage", () => {
  const service = serviceSource()

  assert.match(service, /const providerCoveredRanges = \[\.\.\.coveredRanges\]/)
  assert.match(service, /providerCoveredRanges\.push\(range\)/)
  assert.match(
    service,
    /const gaps = uncoveredProviderRanges\(\s*detectTradingSessionGaps\(normalized\.bars\),\s*providerCoveredRanges\s*\)/,
  )
})
