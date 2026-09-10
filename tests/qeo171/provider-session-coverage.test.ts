import assert from "node:assert/strict"
import test from "node:test"

import * as providerCoverage from "../../modules/market/chart-data/provider-coverage.ts"

type Range = { from: number; to: number }
type MissingTradingProviderRanges = (request: Range, covered: Range[]) => Range[]

function epoch(value: string) {
  return Math.floor(Date.parse(value) / 1000)
}

test("QEO-171 provider recovery ignores overnight/lunch/after-close holes", () => {
  const candidate = (providerCoverage as unknown as Record<string, unknown>).missingTradingProviderRanges
  assert.equal(typeof candidate, "function", "production provider coverage must expose session-aware missing ranges")
  const missingTradingProviderRanges = candidate as MissingTradingProviderRanges

  const request = {
    from: epoch("2026-09-09T18:31:16+07:00"),
    to: epoch("2026-09-10T20:01:20+07:00"),
  }
  const fullSessionCoverage = [{
    from: epoch("2026-09-10T09:00:00+07:00"),
    to: epoch("2026-09-10T14:46:00+07:00"),
  }]

  assert.deepEqual(missingTradingProviderRanges(request, fullSessionCoverage), [])

  const morningOnlyCoverage = [{
    from: epoch("2026-09-10T09:00:00+07:00"),
    to: epoch("2026-09-10T11:30:00+07:00"),
  }]
  assert.deepEqual(
    missingTradingProviderRanges({
      from: epoch("2026-09-10T09:00:00+07:00"),
      to: epoch("2026-09-10T20:01:20+07:00"),
    }, morningOnlyCoverage),
    [{
      from: epoch("2026-09-10T13:00:00+07:00"),
      to: epoch("2026-09-10T14:46:00+07:00"),
    }],
  )

  assert.deepEqual(
    missingTradingProviderRanges({
      from: epoch("2026-09-12T00:00:00+07:00"),
      to: epoch("2026-09-13T23:59:59+07:00"),
    }, []),
    [],
    "weekend-only requests must not hit a provider",
  )
})
