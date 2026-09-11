import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import * as providerCoverage from "../../modules/market/chart-data/provider-coverage.ts"

type Range = { from: number; to: number }
type MissingTradingProviderRanges = (request: Range, covered: Range[]) => Range[]
type ProviderConfirmedSparseGap = (gap: { fromTime: number; toTime: number }, covered: Range[]) => boolean

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

test("QEO-171 canonical intraday service never bypasses session-aware recovery", () => {
  const source = readFileSync(new URL("../../modules/market/chart-data/service.ts", import.meta.url), "utf8")
  const section = source.match(/const closedUncoveredRanges[\s\S]*?const closedStorageGapRanges/)?.[0] ?? ""
  assert.match(section, /missingTradingProviderRanges\(closedRequestedRange, coveredRanges\)/)
  assert.doesNotMatch(section, /normalized\.bars\.length === 0[\s\S]*?\[closedRequestedRange\]/)
})

test("QEO-172 provider-confirmed sparse 1m gaps are non-blocking but uncovered gaps remain blocking", () => {
  const candidate = (providerCoverage as unknown as Record<string, unknown>).isProviderConfirmedSparseGap
  assert.equal(typeof candidate, "function", "provider coverage must expose provider-confirmed sparse-gap proof")
  const isProviderConfirmedSparseGap = candidate as ProviderConfirmedSparseGap

  const gap = {
    fromTime: epoch("2026-09-08T11:10:00+07:00"),
    toTime: epoch("2026-09-08T11:13:00+07:00"),
  }

  assert.equal(isProviderConfirmedSparseGap(gap, [{
    from: epoch("2026-09-03T00:00:00+07:00"),
    to: epoch("2026-09-09T18:31:16+07:00"),
  }]), true)

  assert.equal(isProviderConfirmedSparseGap(gap, [{
    from: epoch("2026-09-08T09:00:00+07:00"),
    to: epoch("2026-09-08T11:10:00+07:00"),
  }]), false)
})

test("QEO-172 final canonical gaps honor provider-confirmed sparse intervals", () => {
  const source = readFileSync(new URL("../../modules/market/chart-data/service.ts", import.meta.url), "utf8")
  const finalGapSection = source.match(/const gaps = detectTradingSessionGaps\(normalized\.bars\)[\s\S]*?const uniqueErrors/)?.[0] ?? ""
  assert.match(finalGapSection, /isProviderConfirmedSparseGap/)
  assert.match(finalGapSection, /coveredRanges/)
})
