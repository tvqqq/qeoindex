import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  chartHistoryClass,
  chartHotRetentionCutoff,
  clampChartHistoryRange,
  maxChartHistorySeconds,
} from "../modules/market/chart-data/history-policy.ts"
import { missingProviderRanges } from "../modules/market/chart-data/provider-coverage.ts"
import {
  MARKET_DATA_PROBE_PROVIDERS,
  ProviderProbeError,
  normalizeProbeRequest,
} from "../modules/market/provider-benchmark/contract.ts"
import {
  parseSsiIboardPayload,
  ssiIboardResolutionToken,
} from "../modules/market/provider-benchmark/providers/ssi-iboard.ts"

const DAY = 86400

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-100 chart history policy maps exact product horizons", () => {
  for (const resolution of ["1m", "15m", "30m"] as const) {
    assert.equal(chartHistoryClass(resolution), "SHORT")
    assert.equal(maxChartHistorySeconds(resolution), 31 * DAY)
  }
  for (const resolution of ["1h", "2h", "4h"] as const) {
    assert.equal(chartHistoryClass(resolution), "MID")
    assert.equal(maxChartHistorySeconds(resolution), 366 * DAY)
  }
  for (const resolution of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as const) {
    assert.equal(chartHistoryClass(resolution), "LONG")
    assert.equal(maxChartHistorySeconds(resolution), null)
  }
})

test("QEO-100 history clamp never expands a request and clamps only short/mid lower bounds", () => {
  const to = 2_000_000_000
  const short = clampChartHistoryRange({ resolution: "15m", from: to - 60 * DAY, to, now: to + DAY })
  assert.deepEqual(short, { from: to - 31 * DAY, to, clamped: true })
  const mid = clampChartHistoryRange({ resolution: "4h", from: to - 500 * DAY, to, now: to + DAY })
  assert.deepEqual(mid, { from: to - 366 * DAY, to, clamped: true })
  const long = clampChartHistoryRange({ resolution: "1D", from: 1_000_000_000, to, now: to + DAY })
  assert.deepEqual(long, { from: 1_000_000_000, to, clamped: false })
  const alreadyNarrow = clampChartHistoryRange({ resolution: "1m", from: to - 3 * DAY, to, now: to + DAY })
  assert.deepEqual(alreadyNarrow, { from: to - 3 * DAY, to, clamped: false })
})

test("QEO-103 hot retention cutoff keeps complete Vietnam calendar dates", () => {
  const referenceAt = new Date("2026-09-05T12:34:00+07:00")
  assert.equal(new Date(chartHotRetentionCutoff(referenceAt) * 1000).toISOString(), "2026-08-05T17:00:00.000Z")
})

test("QEO-103 hourly read path uses derived cache only after cold-manifest coverage is complete", () => {
  const service = source("modules/market/chart-data/timeframe-service.ts")
  assert.match(service, /readDerivedHourlyRange/)
  assert.match(service, /derivedHourlyColdCoverageComplete/)
  assert.match(service, /readIntersectingRange/)
  assert.match(service, /VERIFIED_COLD_1M_RECOVERY/)
  assert.match(service, /chartHotRetentionCutoff/)
  assert.match(service, /const oldTo = Math\.min\(request\.to, hotCutoff - 1\)/)
  assert.match(service, /const recentFrom = Math\.max\(sourceRange\.from, hotCutoff\)/)
  assert.match(service, /aggregateChartTimeframe\(mergeBars\(recentResults\), "1h"\)/)
  assert.match(service, /request\.resolution === "1h" \? mergedHourly : aggregateChartTimeframe\(mergedHourly, request\.resolution\)/)
})

test("QEO-103 legacy derived recovery re-verifies cold raw before cache persistence", () => {
  const recovery = source("modules/market/chart-data/derived-hourly-recovery.ts")
  assert.match(recovery, /listVerifiedColdManifests/)
  assert.match(recovery, /readVerifiedColdManifest/)
  assert.match(recovery, /aggregateChartTimeframe\(verified\.bars, "1h"\)/)
  assert.match(recovery, /upsertDerivedHourlyBars/)
  assert.match(recovery, /readDerivedHourlyByManifest/)
  assert.ok(recovery.indexOf("readVerifiedColdManifest") < recovery.lastIndexOf("upsertDerivedHourlyBars"))
  assert.ok(recovery.lastIndexOf("upsertDerivedHourlyBars") < recovery.lastIndexOf("readDerivedHourlyByManifest"))
})

test("QEO-103 archive is cache-before-prune and prune authority is manifest verified", () => {
  const lifecycle = source("modules/market/chart-data/archive-lifecycle.ts")
  const hotStore = source("modules/market/chart-data/hot-store.ts")
  const migration = source("supabase/migrations/20260905115319_qeo103_chart_storage_lifecycle.sql")
  assert.match(lifecycle, /upsertDerivedHourlyBars/)
  assert.match(lifecycle, /pruneVerifiedHotIntradayPartition/)
  assert.ok(lifecycle.indexOf("upsertDerivedHourlyBars") < lifecycle.lastIndexOf("pruneVerifiedHotIntradayPartition"))
  assert.match(hotStore, /qeo_prune_verified_chart_intraday_partition/)
  assert.match(migration, /chart_ohlcv_derived_hourly/)
  assert.match(migration, /derived hourly cache missing for manifest/)
  assert.match(migration, /hot row-count mismatch before prune/)
  assert.doesNotMatch(migration, /CASCADE/i)
})

test("QEO-106 Daily cold schema reuses verified manifests and keeps prune fail-closed", () => {
  const migration = source("supabase/pending-migrations/20260905153500_qeo106_daily_hot_cold_history.sql")
  assert.match(migration, /base_resolution in \('1m', '1D'\)/i)
  assert.match(migration, /add column if not exists provenance jsonb/i)
  assert.match(migration, /create table if not exists public\.chart_daily_history_state/i)
  assert.match(migration, /qeo_prune_verified_chart_daily_partition/i)
  assert.match(migration, /v_manifest\.base_resolution <> '1D'/i)
  assert.match(migration, /market_ohlcv_history/i)
  assert.match(migration, /timeframe = '1D'/i)
  assert.match(migration, /hot row-count mismatch before prune/i)
  assert.doesNotMatch(migration, /CASCADE/i)
})

test("QEO-106 cold-store supports Daily partitions without changing the legacy 1m factory", () => {
  const cold = source("modules/market/chart-data/cold-store.ts")
  assert.match(cold, /createSupabaseDailyColdOhlcvStorage/)
  assert.match(cold, /baseResolution: "1m" \| "1D"/)
  assert.match(cold, /`\$\{baseResolution\}\/ticker=\$\{ticker\}/)
  assert.match(cold, /\.eq\("base_resolution", baseResolution\)/)
  assert.match(cold, /base_resolution: baseResolution/)
  assert.match(cold, /createResolutionColdOhlcvStorage\(supabase, "1m"\)/)
  assert.match(cold, /createResolutionColdOhlcvStorage\(supabase, "1D"\)/)
})

test("QEO-106 canonical Daily merges Hot PostgreSQL + verified Cold Storage and Hot wins overlap", () => {
  const service = source("modules/market/chart-data/service.ts")
  const normalize = source("modules/market/chart-data/normalize.ts")
  assert.match(service, /createSupabaseDailyColdOhlcvStorage/)
  assert.match(service, /Promise\.allSettled\(\[/)
  assert.match(service, /loadDailyRows/)
  assert.match(service, /dailyColdStorage\.readIntersectingRange/)
  assert.match(service, /detectDailySessionGaps/)
  assert.match(service, /source: "cold"/)
  assert.match(service, /source: "daily"/)
  assert.match(normalize, /daily: 3/)
  assert.match(normalize, /cold: 2/)
})

test("QEO-106 deep Daily history is resumable, bounded, provider-backed and archive-before-prune", () => {
  const history = source("modules/market/history/daily-cold-history.ts")
  const route = source("app/api/admin/market/daily-history/backfill/route.ts")
  assert.match(history, /DAILY_BACKFILL_DAYS/)
  assert.match(history, /fetchDailyMarketHistoryWindow/)
  assert.match(history, /createSupabaseDailyColdOhlcvStorage/)
  assert.match(history, /chart_daily_history_state/)
  assert.match(history, /maxChunksPerTicker/)
  assert.match(history, /archiveVerifiedPartition/)
  assert.match(history, /qeo_prune_verified_chart_daily_partition/)
  assert.match(history, /providerExhaustedWithoutData/)
  assert.match(history, /provider === "Fallback" \? valid\.filter\(\(bar\) => bar\.volume > 0\)/)
  assert.ok(history.indexOf("archiveVerifiedPartition") < history.lastIndexOf("qeo_prune_verified_chart_daily_partition"))
  assert.doesNotMatch(history, /synthetic|fillForward|fabricate/i)
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /backfillDailyColdHistory/)
  assert.match(route, /10/)
})

test("QEO-100 incomplete stored coverage backfills the missing head instead of trusting lastStored", () => {
  assert.deepEqual(missingProviderRanges({ from: 100, to: 1_000 }, [{ from: 700, to: 1_000 }]), [{ from: 100, to: 700 }])
  assert.deepEqual(missingProviderRanges({ from: 100, to: 1_000 }, [{ from: 100, to: 400 }, { from: 700, to: 1_000 }]), [{ from: 400, to: 700 }])
  assert.deepEqual(missingProviderRanges({ from: 100, to: 1_000 }, [{ from: 700, to: 1_000 }, { from: 100, to: 750 }]), [])
})

test("QEO-100 1m loadOlder progressively hydrates the bounded horizon independent of gestures", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const hook = source("components/stock-detail/chart/use-chart-history.ts")
  assert.match(wrapper, /timeframe !== "1m" \|\| loading \|\| loadingOlder \|\| !hasMore/)
  assert.match(wrapper, /void loadOlder\(\)/)
  assert.match(wrapper, /if \(timeframe === "1m"\) return/)
  assert.match(wrapper, /timeframe !== "1m" && event\.deltaY > 0/)
  assert.match(hook, /historyCursorRef/)
  assert.match(hook, /historyCursorRef\.current = range\.from/)
  assert.match(hook, /olderChartHistoryRange\(timeframe, cursor, horizonTo\)/)
  assert.match(hook, /setHasMore\(range\.from > chartHistoryFloor\(timeframe, horizonTo\) \+ 1\)/)
  assert.doesNotMatch(hook, /setHasMore\(result\.bars\.length > 0/)
})

test("QEO-100 provider benchmark contract includes SSI iBoard first and bounded canonical resolutions", () => {
  assert.deepEqual(MARKET_DATA_PROBE_PROVIDERS, ["SSI_IBOARD", "DNSE", "VCI", "KBS"])
  assert.deepEqual(normalizeProbeRequest({ ticker: " vic ", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 }), { ticker: "VIC", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 })
  assert.throws(() => normalizeProbeRequest({ ticker: "VIC", resolution: "15m" as never, from: 1, to: 2 }))
})

test("QEO-100 SSI iBoard parser normalizes UDF envelope and clips requested range", () => {
  const result = parseSsiIboardPayload({
    code: "SUCCESS", status: "ok",
    data: { s: "ok", t: [90, 100, 160, 220], o: [9, 10, 11, 12], h: [10, 12, 13, 13], l: [8, 9, 10, 11], c: [9.5, 11, 12, 12.5], v: [90, 100, 200, 300] },
  }, { ticker: "VIC", resolution: "1m", from: 100, to: 200 })
  assert.deepEqual(result.map((bar) => bar.time), [100, 160])
  assert.equal(result[0].open, 10)
  assert.equal(result[1].volume, 200)
  assert.equal(ssiIboardResolutionToken("1m"), "1")
  assert.equal(ssiIboardResolutionToken("1D"), "1D")
})

test("QEO-100 SSI iBoard parser rejects misaligned arrays as MALFORMED_RESPONSE", () => {
  assert.throws(
    () => parseSsiIboardPayload({ code: "SUCCESS", status: "ok", data: { s: "ok", t: [100, 160], o: [1], h: [2, 2], l: [1, 1], c: [2, 2], v: [10, 20] } }, { ticker: "VIC", resolution: "1m", from: 100, to: 200 }),
    (error: unknown) => error instanceof ProviderProbeError && error.errorClass === "MALFORMED_RESPONSE",
  )
})
