import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { overlayCouncilRatingWithEodSnapshot } from "../lib/ai-council-eod-market.ts"
import type { CouncilRatingEvidence } from "../lib/ai-council-model.ts"
import {
  WYCKOFF_EOD_BATCH_SIZE,
  WYCKOFF_EOD_MAX_STOCKS,
  buildWyckoffEodBatchOffsets,
  validateWyckoffEodDailyRows,
} from "../lib/wyckoff-eod-refresh.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function ratingFixture(): CouncilRatingEvidence {
  return {
    ticker: "MSN",
    companyName: "Masan",
    sector: "Consumer",
    exchange: "HOSE",
    rank: 1,
    price: 69.8,
    changePct: 0,
    ratingScore: 70,
    score4m: 80,
    canslimScore: 75,
    pricePotential: "Neutral",
    stockRsScore: 60,
    sectorRsScore: 55,
    rsShort: 62,
    rsMedium: 58,
    stockRrgState: "Dẫn dắt",
    sectorRrgState: "Phục hồi",
    weeklyChangePct: 2,
    monthlyChangePct: 5,
    beta: 1,
    peTtm: 20,
    pbTtm: 3,
    fundamentals: { revenueGrowthPct: 10, netIncomeGrowthPct: 15, roePct: 18, roaPct: 7, netMarginPct: 9 },
    technical: { priceVsSma10Pct: 1, priceVsSma20Pct: 2, priceVsSma50Pct: 3, priceVsSma100Pct: 4, priceVsSma200Pct: 5, macdVsSignal: "above" },
    liquidity: { volume1d: 1_000_000, averageVolume10d: 2_000_000, averageVolume20d: 2_100_000, averageVolume50d: 2_200_000, volumeVsPreviousSessionPct: 10, tradedValueVsPreviousSessionPct: 12 },
    flow: { netForeignTradingBillion: 1, netProprietaryTradingBillion: 2 },
  }
}

test("EOD refresh plans the 200-stock cap as twenty bounded batches", () => {
  assert.equal(WYCKOFF_EOD_MAX_STOCKS, 200)
  assert.equal(WYCKOFF_EOD_BATCH_SIZE, 10)
  assert.deepEqual(buildWyckoffEodBatchOffsets(200), Array.from({ length: 20 }, (_, index) => index * 10))
  assert.deepEqual(buildWyckoffEodBatchOffsets(17), [0, 10])
})

test("EOD refresh rejects a mixed-session 1D snapshot set", () => {
  const tickers = ["AAA", "BBB", "CCC"]
  const result = validateWyckoffEodDailyRows({
    expectedSessionDate: "2026-08-24",
    expectedTickers: tickers,
    rows: [
      { ticker: "AAA", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
      { ticker: "BBB", timeframe: "1D", bar_closed_at: "2026-08-21T07:00:00.000Z" },
    ],
  })
  assert.equal(result.ok, false)
  assert.equal(result.freshCount, 1)
  assert.deepEqual(result.staleOrMissingTickers, ["BBB", "CCC"])
})

test("EOD refresh accepts an exact same-session 1D snapshot set", () => {
  const result = validateWyckoffEodDailyRows({
    expectedSessionDate: "2026-08-24",
    expectedTickers: ["AAA", "BBB"],
    rows: [
      { ticker: "AAA", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
      { ticker: "BBB", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.freshCount, 2)
  assert.deepEqual(result.staleOrMissingTickers, [])
})

test("operational Wyckoff runner bypasses UI history caches for EOD decisions", () => {
  const runner = source("lib/wyckoff-unified-runner.ts")
  assert.match(runner, /fetchLongDailyMarketHistory/)
  assert.match(runner, /fetchHourlyMarketHistory/)
  assert.doesNotMatch(runner, /getCachedLongDailyHistory|getCachedHourlyHistory|request-cache/)
})

test("Council EOD overlay replaces only completed-session price, change and volume", () => {
  const result = overlayCouncilRatingWithEodSnapshot(ratingFixture(), {
    symbol: "MSN", session_date: "2026-08-24", reference_price: 69.8, latest_price: 70,
    total_volume: 4_715_100, updated_at: "2026-08-24T07:55:07.130Z",
  }, "2026-08-24")
  assert.equal(result.applied, true)
  assert.equal(result.rating.price, 70)
  assert.equal(Number(result.rating.changePct?.toFixed(4)), 0.2865)
  assert.equal(result.rating.liquidity.volume1d, 4_715_100)
  assert.equal(result.rating.score4m, 80)
  assert.equal(result.rating.rsShort, 62)
  assert.equal(result.rating.flow.netForeignTradingBillion, 1)
})

test("Council EOD overlay refuses stale or pre-final snapshots", () => {
  const staleDate = overlayCouncilRatingWithEodSnapshot(ratingFixture(), {
    symbol: "MSN", session_date: "2026-08-21", reference_price: 69.8, latest_price: 70,
    total_volume: 4_715_100, updated_at: "2026-08-21T07:55:07.130Z",
  }, "2026-08-24")
  const tooEarly = overlayCouncilRatingWithEodSnapshot(ratingFixture(), {
    symbol: "MSN", session_date: "2026-08-24", reference_price: 69.8, latest_price: 70,
    total_volume: 4_715_100, updated_at: "2026-08-24T07:30:00.000Z",
  }, "2026-08-24")
  assert.equal(staleDate.applied, false)
  assert.equal(tooEarly.applied, false)
  assert.equal(staleDate.rating.price, 69.8)
  assert.equal(tooEarly.rating.liquidity.volume1d, 1_000_000)
})

test("operational Council operations request the rebuilt final EOD evidence ensemble", () => {
  const eodData = source("lib/ai-council-eod-data.ts")
  const runtime = source("lib/ai-council-runtime.ts")
  const operations = source("lib/ai-council-operations.ts")
  const daily = source("app/api/ai-council/daily/route.ts")
  const debate = source("app/api/ai-council/debate-daily/route.ts")
  assert.match(eodData, /stock_orderbook_snapshots/)
  assert.match(eodData, /overlayCouncilRatingWithEodSnapshot/)
  assert.match(eodData, /buildCouncilStock/)
  assert.match(eodData, /eodMarketOverlay/)
  assert.match(runtime, /includeEodMarketOverlay/)
  assert.match(daily, /runAiCouncilDailyOperation/)
  assert.match(debate, /runAiCouncilDebateOperation/)
  assert.equal((operations.match(/includeEodMarketOverlay:\s*true/g) || []).length, 2)
})

test("EOD orchestration is one durable unified dependency workflow", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const operations = source("lib/ai-council-operations.ts")
  const route = source("app/api/qeoindex/eod/route.ts")
  assert.match(workflow, /"use workflow"/)
  assert.doesNotMatch(workflow, /"use step"/)
  assert.match(steps, /"use step"/)
  assert.match(steps, /refreshOhlcvHistoryBatch/)
  assert.doesNotMatch(steps, /refreshOhlcvHistoryUniverse/)
  assert.match(workflow, /for \(let offset = 0; offset < ready\.stocks\.length; offset \+= 10\)/)
  assert.match(workflow, /ready\.stocks\.slice\(offset, offset \+ 10\)/)
  assert.match(steps, /buildWyckoffV2TickerSnapshots/)
  assert.match(steps, /publishWyckoffV2SnapshotsDirect/)
  assert.match(steps, /runAiCouncilDailyOperation/)
  assert.match(steps, /runAiCouncilDebateOperation/)
  assert.match(operations, /export async function runAiCouncilDailyOperation/)
  assert.match(operations, /export async function runAiCouncilDebateOperation/)
  assert.match(route, /start\(qeoindexEodPipeline/)
  assert.match(route, /isMachineRequestAuthorized/)
})

test("unified EOD workflow is fail-closed and orders readiness -> history -> Wyckoff -> Supabase validate/publish -> Council -> archive", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const bodyStart = workflow.indexOf("export async function qeoindexEodPipeline")
  const body = workflow.slice(bodyStart)
  const market = body.indexOf("runEodReadyStep")
  const history = body.indexOf("runHistoryRefreshBatchStep")
  const wyckoff = body.indexOf("runWyckoffBuildStep")
  const validation = body.indexOf("runSupabaseValidateStep")
  const publish = body.indexOf("runSupabasePublishStep")
  const deterministic = body.indexOf("runDeterministicCouncilStep")
  const debate = body.indexOf("runLlmDebateStep")
  const notionArchive = body.indexOf("runNotionArchiveStep")
  const driveArchive = body.indexOf("runDriveArchiveStep")
  const retention = body.indexOf("runRetentionCleanupStep")
  assert.ok(bodyStart >= 0)
  assert.ok(market >= 0)
  assert.ok(history > market)
  assert.ok(wyckoff > history)
  assert.ok(validation > wyckoff)
  assert.ok(publish > validation)
  assert.ok(deterministic > publish)
  assert.ok(debate > deterministic)
  assert.ok(notionArchive > debate)
  assert.ok(driveArchive > notionArchive)
  assert.ok(retention > driveArchive)
  assert.match(body, /published && deterministic\.ok/)
  assert.match(body, /failQeoIndexEodRunStep/)
  assert.doesNotMatch(body, /runNotionValidateStep|runNotionStagingBatchStep|runIngestStep/)
})

test("production has one Supabase-triggered EOD chain and no legacy Vercel EOD cron", () => {
  const config = JSON.parse(source("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> }
  const crons = config.crons || []
  const scheduler = source("supabase/migrations/20260825174500_qeoindex_eod_pipeline_cron.sql")
  assert.match(scheduler, /'15 8 \* \* 1-5'/)
  assert.match(scheduler, /\/api\/qeoindex\/eod/)
  assert.equal(crons.some((cron) => cron.path === "/api/ai-council/eod"), false)
  assert.equal(crons.some((cron) => cron.path === "/api/wyckoff/ingest"), false)
  assert.equal(crons.some((cron) => cron.path === "/api/ai-council/daily"), false)
  assert.equal(crons.some((cron) => cron.path === "/api/ai-council/debate-daily"), false)
})
