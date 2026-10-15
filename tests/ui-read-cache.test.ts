import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { readThroughUiCache } from "../modules/shared/cache/ui-data-cache.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("P1 UI reads use Runtime Cache with optional shared Redis", () => {
  const cache = source("modules/shared/cache/ui-data-cache.ts")
  assert.match(cache, /getCache/)
  assert.match(cache, /Redis\.fromEnv/)
  assert.match(cache, /cache\.get\(key\)/)
  assert.match(cache, /redisClient\.get/)
  assert.match(cache, /cache\.set\(key/)
  assert.match(cache, /expireTag\(tag\)/)
  assert.match(cache, /useSharedRedis/)

  const research = source("modules/research/data.ts")
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

  const researchRoute = source("app/research/page.tsx")
  assert.match(researchRoute, /getResearchOverviewData/)
  assert.match(researchRoute, /getResearchChangesData/)
  assert.match(researchRoute, /getResearchLogData/)
  assert.match(researchRoute, /pagination\.nextCursor/)
  assert.match(researchRoute, /getResearchReviewData/)
})

test("optional UI cache budget stops after a stalled Runtime Cache read and still loads canonical data", async () => {
  let redisReads = 0
  let writes = 0
  let loads = 0
  const startedAt = Date.now()
  const value = await readThroughUiCache({
    namespace: "test",
    key: "stalled-read",
    tag: "test",
    name: "test",
    ttlSeconds: 10,
    ioBudgetMs: 35,
    validate: (candidate): candidate is string => typeof candidate === "string",
    load: async () => {
      loads += 1
      return "canonical"
    },
  }, {
    getCache: () => ({
      get: () => new Promise<unknown>(() => {}),
      set: async () => { writes += 1 },
    }),
    getRedis: () => ({
      get: async <T>() => {
        redisReads += 1
        return null as T | null
      },
      set: async () => { writes += 1 },
    }),
  })

  assert.equal(value, "canonical")
  assert.equal(loads, 1)
  assert.equal(redisReads, 0, "a timed-out Runtime Cache read must not start the next cache read")
  assert.equal(writes, 0, "the exhausted cache budget must not start cache writes")
  assert.ok(Date.now() - startedAt < 500)
})

test("optional UI cache budget bounds cache writes after a valid canonical load", async () => {
  let runtimeWrites = 0
  let redisWrites = 0
  const startedAt = Date.now()
  const value = await readThroughUiCache({
    namespace: "test",
    key: "stalled-write",
    tag: "test",
    name: "test",
    ttlSeconds: 10,
    ioBudgetMs: 35,
    validate: (candidate): candidate is string => typeof candidate === "string",
    load: async () => "canonical",
  }, {
    getCache: () => ({
      get: async () => null,
      set: async () => {
        runtimeWrites += 1
        return new Promise<never>(() => {})
      },
    }),
    getRedis: () => ({
      get: async <T>() => null as T | null,
      set: async () => {
        redisWrites += 1
        return new Promise<never>(() => {})
      },
    }),
  })

  assert.equal(value, "canonical")
  assert.equal(runtimeWrites, 1)
  assert.equal(redisWrites, 1)
  assert.ok(Date.now() - startedAt < 500, "cache writes must not delay the valid canonical result indefinitely")
})

test("omitting the UI cache budget keeps the default read-through await behavior", async () => {
  let releaseRuntimeRead: ((value: unknown) => void) | undefined
  const pendingRuntimeRead = new Promise<unknown>((resolve) => { releaseRuntimeRead = resolve })
  let resolved = false
  const read = readThroughUiCache({
    namespace: "test",
    key: "default-read",
    tag: "test",
    name: "test",
    ttlSeconds: 10,
    validate: (candidate): candidate is string => typeof candidate === "string",
    load: async () => "canonical",
  }, {
    getCache: () => ({
      get: () => pendingRuntimeRead,
      set: async () => undefined,
    }),
    getRedis: () => null,
  }).then((value) => {
    resolved = true
    return value
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(resolved, false)
  releaseRuntimeRead?.(null)
  assert.equal(await read, "canonical")
})

test("P1.1 scanner and market history miss paths are bounded", () => {
  const scanner = source("modules/signals/scanner/data.ts")
  assert.match(scanner, /loadLatestScanPages/)
  assert.match(scanner, /pageSize: 1/)
  assert.match(scanner, /filter: \{ property: "Date", date: \{ equals: latestDate \} \}/)
  assert.match(scanner, /getScannerTickerData/)
  assert.match(scanner, /rich_text: \{ equals: normalized \}/)
  assert.match(scanner, /getScannerDataFresh/)
  assert.match(scanner, /invalidateScannerDataCache/)
  assert.doesNotMatch(scanner, /direction: "descending" \}\] \}, 5\)/)

  const history = source("modules/market/history/index.ts")
  assert.match(history, /fetchDailyMarketHistoryUi/)
  assert.match(history, /ttlSeconds: 15 \* 60/)
  assert.match(history, /fetchHourlyMarketHistoryUi/)
  assert.match(history, /ttlSeconds: 5 \* 60/)

  const requestCache = source("modules/shared/cache/request-cache.ts")
  assert.match(requestCache, /fetchDailyMarketHistoryUi/)
  assert.match(requestCache, /fetchHourlyMarketHistoryUi/)
})

test("P1.1 signal UI cache is isolated from fresh operational decisions", () => {
  const signalData = source("modules/signals/data.ts")
  assert.match(signalData, /getSignalUiData/)
  assert.match(signalData, /ttlSeconds: 20/)
  assert.match(signalData, /getOpenRecommendationsFresh/)
  assert.match(signalData, /filter: \{ property: "Status", select: \{ equals: "Open" \} \}/)
  assert.match(signalData, /invalidateSignalDataCache/)

  const researchRoute = source("app/research/page.tsx")
  assert.match(researchRoute, /getSignalUiData/)

  const monitor = source("modules/signals/monitor.ts")
  assert.match(monitor, /getScannerDataFresh/)
  assert.match(monitor, /getOpenRecommendationsFresh/)
  assert.doesNotMatch(monitor, /getScannerData\(\)/)
})

test("operational write paths bypass UI cache and invalidate successful writes", () => {
  const promote = source("app/api/research/promote/route.ts")
  assert.match(promote, /getResearchDataFresh/)
  assert.match(promote, /getScannerDataFresh/)
  assert.match(promote, /await invalidateResearchDataCache\(\)/)

  const runner = source("modules/signals/scanner/runner.ts")
  assert.match(runner, /getScannerDataFresh/)
  assert.match(runner, /completed\.length > 0/)
  assert.match(runner, /await invalidateScannerDataCache\(\)/)
})

test("P2 Singapore runtime and bounded DNSE UI batching remain enabled", () => {
  const vercel = JSON.parse(source("vercel.json")) as { regions?: string[] }
  assert.deepEqual(vercel.regions, ["sin1"])

  const board = source("components/live-market-board.tsx")
  assert.match(board, /const MARKET_UI_COMMIT_MS = 250/)
  assert.match(board, /const MARKET_ORDERING_REFRESH_MS = 1000/)
  assert.match(board, /const updateLiveQuote = useCallback/)
  assert.match(board, /let messageQueue: string\[\] = \[\]/)
  assert.match(board, /window\.requestAnimationFrame\(flushMessageQueue\)/)
  assert.match(board, /window\.cancelAnimationFrame\(messageFrame\)/)
})
