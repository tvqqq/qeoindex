import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("P1 UI reads use Runtime Cache with optional shared Redis", () => {
  const cache = source("lib/ui-data-cache.ts")
  assert.match(cache, /getCache/)
  assert.match(cache, /Redis\.fromEnv/)
  assert.match(cache, /cache\.get\(key\)/)
  assert.match(cache, /redisClient\.get/)
  assert.match(cache, /cache\.set\(key/)
  assert.match(cache, /expireTag\(tag\)/)
  assert.match(cache, /useSharedRedis/)

  const research = source("lib/research-data.ts")
  assert.match(research, /getResearchOverviewData/)
  assert.match(research, /getResearchChangesData/)
  assert.match(research, /getResearchLogData/)
  assert.match(research, /getResearchReviewData/)
  assert.match(research, /getResearchTickerData/)
  assert.match(research, /pageSize: 50/)
  assert.match(research, /relation: \{ contains: thesis\.id \}/)
  assert.match(research, /projection mặc định giới hạn 100 Analysis Log/)
  assert.match(research, /getResearchDataFresh/)
  assert.match(research, /invalidateResearchDataCache/)

  const overviewRoute = source("app/research/page.tsx")
  const changesRoute = source("app/research/changes/page.tsx")
  const logRoute = source("app/research/log/page.tsx")
  const reviewRoute = source("app/research/review/page.tsx")
  assert.match(overviewRoute, /getResearchOverviewData/)
  assert.match(changesRoute, /getResearchChangesData/)
  assert.match(logRoute, /getResearchLogData/)
  assert.match(logRoute, /pagination\.nextCursor/)
  assert.match(reviewRoute, /getResearchReviewData/)
})

test("P1.1 scanner and market history miss paths are bounded", () => {
  const scanner = source("lib/scanner-data.ts")
  assert.match(scanner, /loadLatestScanPages/)
  assert.match(scanner, /pageSize: 1/)
  assert.match(scanner, /filter: \{ property: "Date", date: \{ equals: latestDate \} \}/)
  assert.match(scanner, /getScannerTickerData/)
  assert.match(scanner, /rich_text: \{ equals: normalized \}/)
  assert.match(scanner, /getScannerDataFresh/)
  assert.match(scanner, /invalidateScannerDataCache/)
  assert.doesNotMatch(scanner, /direction: "descending" \}\] \}, 5\)/)

  const history = source("lib/market-history.ts")
  assert.match(history, /fetchDailyMarketHistoryUi/)
  assert.match(history, /ttlSeconds: 15 \* 60/)
  assert.match(history, /fetchHourlyMarketHistoryUi/)
  assert.match(history, /ttlSeconds: 5 \* 60/)

  const requestCache = source("lib/request-cache.ts")
  assert.match(requestCache, /fetchDailyMarketHistoryUi/)
  assert.match(requestCache, /fetchHourlyMarketHistoryUi/)
})

test("P1.1 signal UI cache is isolated from fresh operational decisions", () => {
  const signalData = source("lib/signal-data.ts")
  assert.match(signalData, /getSignalUiData/)
  assert.match(signalData, /ttlSeconds: 20/)
  assert.match(signalData, /getOpenRecommendationsFresh/)
  assert.match(signalData, /filter: \{ property: "Status", select: \{ equals: "Open" \} \}/)
  assert.match(signalData, /invalidateSignalDataCache/)

  const signalsPage = source("app/research/signals/page.tsx")
  assert.match(signalsPage, /getSignalUiData/)

  const monitor = source("lib/signal-monitor.ts")
  assert.match(monitor, /getScannerDataFresh/)
  assert.match(monitor, /getOpenRecommendationsFresh/)
  assert.doesNotMatch(monitor, /getScannerData\(\)/)
})

test("operational write paths bypass UI cache and invalidate successful writes", () => {
  const promote = source("app/api/research/promote/route.ts")
  assert.match(promote, /getResearchDataFresh/)
  assert.match(promote, /getScannerDataFresh/)
  assert.match(promote, /await invalidateResearchDataCache\(\)/)

  const runner = source("lib/scanner-runner.ts")
  assert.match(runner, /getScannerDataFresh/)
  assert.match(runner, /completed\.length > 0/)
  assert.match(runner, /await invalidateScannerDataCache\(\)/)
})

test("P2 Singapore runtime and DNSE frame batching remain enabled", () => {
  const vercel = JSON.parse(source("vercel.json")) as { regions?: string[] }
  assert.deepEqual(vercel.regions, ["sin1"])

  const board = source("components/live-market-board-v2.tsx")
  assert.match(board, /let messageQueue: Array<\(\) => void> = \[\]/)
  assert.match(board, /window\.requestAnimationFrame\(flushMessageQueue\)/)
  assert.match(board, /window\.cancelAnimationFrame\(messageFrame\)/)
})
