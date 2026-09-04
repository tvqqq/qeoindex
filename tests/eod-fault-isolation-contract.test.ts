import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import test from "node:test"

// QEO-61 regression contract: partial runs must remain observable and recover only through exact targeted retry.
function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const faultModuleUrl = new URL("../modules/eod/fault-isolation.ts", import.meta.url)
const retryWorkflowUrl = new URL("../workflows/qeoindex-eod-retry.ts", import.meta.url)
const retryRouteUrl = new URL("../app/api/admin/qeoindex/eod/retry/route.ts", import.meta.url)

test("QEO-61 classifies ticker-local versus systemic failures without downgrading critical faults", async () => {
  assert.equal(existsSync(faultModuleUrl), true, "fault-isolation policy module must exist")
  if (!existsSync(faultModuleUrl)) return

  const { classifyEodFailure } = await import("../modules/eod/fault-isolation.ts")
  assert.deepEqual(
    classifyEodFailure(new Error("Provider returned no usable completed Daily bars"), { stage: "HISTORY_REFRESH", ticker: "VGI" }),
    { errorClass: "ticker_local", retryEligible: true },
  )
  assert.deepEqual(
    classifyEodFailure(Object.assign(new Error("HTTP_429 rate limited"), { status: 429 }), { stage: "MARKET_CLOSE_COLLECT" }),
    { errorClass: "recoverable_systemic", retryEligible: true },
  )
  assert.deepEqual(
    classifyEodFailure(Object.assign(new Error("canonical membership mismatch"), { code: "SUPABASE_VALIDATE_FAILED" }), { stage: "SUPABASE_VALIDATE" }),
    { errorClass: "critical_systemic", retryEligible: false },
  )
})

test("QEO-61 computes exact latest-attempt coverage and keeps prior attempts append-only", async () => {
  assert.equal(existsSync(faultModuleUrl), true, "fault-isolation policy module must exist")
  if (!existsSync(faultModuleUrl)) return

  const { appendTickerAttempts, computeEodTickerCoverage } = await import("../modules/eod/fault-isolation.ts")
  const first = [
    { ticker: "AAA", stage: "WYCKOFF_BUILD", status: "succeeded", errorClass: null, attempt: 1, retryEligible: false },
    { ticker: "BBB", stage: "WYCKOFF_BUILD", status: "failed", errorClass: "ticker_local", attempt: 1, retryEligible: true, error: "bad cache" },
  ] as const
  const partial = computeEodTickerCoverage(["AAA", "BBB"], first)
  assert.equal(partial.complete, false)
  assert.equal(partial.healthyCount, 1)
  assert.equal(partial.failedCount, 1)
  assert.deepEqual(partial.failedTickers, ["BBB"])

  const attempts = appendTickerAttempts(first, [
    { ticker: "BBB", stage: "WYCKOFF_BUILD", status: "succeeded", errorClass: null, attempt: 2, retryEligible: false },
  ])
  assert.equal(attempts.length, 3, "recovery must append instead of rewriting historical attempts")
  const recovered = computeEodTickerCoverage(["AAA", "BBB"], attempts)
  assert.equal(recovered.complete, true)
  assert.deepEqual(recovered.healthyTickers, ["AAA", "BBB"])
})

test("QEO-61 targeted retry only accepts persisted retry-eligible failed tickers", async () => {
  assert.equal(existsSync(faultModuleUrl), true, "fault-isolation policy module must exist")
  if (!existsSync(faultModuleUrl)) return

  const { selectRetryTickers } = await import("../modules/eod/fault-isolation.ts")
  const attempts = [
    { ticker: "AAA", stage: "WYCKOFF_BUILD", status: "succeeded", errorClass: null, attempt: 1, retryEligible: false },
    { ticker: "BBB", stage: "WYCKOFF_BUILD", status: "failed", errorClass: "ticker_local", attempt: 1, retryEligible: true },
    { ticker: "CCC", stage: "HISTORY_REFRESH", status: "failed", errorClass: "ticker_local", attempt: 1, retryEligible: true },
  ] as const

  assert.deepEqual(selectRetryTickers(attempts, ["BBB"]), ["BBB"])
  assert.deepEqual(selectRetryTickers(attempts), ["BBB", "CCC"])
  assert.throws(() => selectRetryTickers(attempts, ["AAA"]), /not retry-eligible/i)
  assert.throws(() => selectRetryTickers(attempts, ["ZZZ"]), /not retry-eligible/i)
})

test("QEO-61 schema permits partial parent runs and preserves exact retry metadata in summaries", () => {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url)
  const matches = readdirSync(migrationsDir).filter((name) => name.endsWith("_qeo61_eod_partial_status.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-61 partial-status migration")
  const sql = source(`supabase/migrations/${matches[0]}`)
  assert.match(sql, /system_job_runs/i)
  assert.match(sql, /status[\s\S]*partial/i)
  assert.match(sql, /check[\s\S]*queued[\s\S]*running[\s\S]*succeeded[\s\S]*partial[\s\S]*failed[\s\S]*skipped/i)
})

test("QEO-61 pipeline terminalizes incomplete canonical build coverage as partial before publish or Council", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const build = workflow.indexOf("runWyckoffBuildStep")
  const partial = workflow.indexOf("completeQeoIndexEodPartialStep", build)
  const validate = workflow.indexOf("runSupabaseValidateStep", build)
  assert.ok(build >= 0 && partial > build, "pipeline must expose a partial completion path after ticker-isolated build")
  assert.ok(validate > partial, "partial gate must execute before atomic validate/publish")
  assert.match(workflow, /build\.failedTickers/)
  assert.match(workflow, /tickerAttempts/)
  assert.match(workflow, /healthyCount[\s\S]*failedCount/)
})

test("QEO-61 targeted retry is root-only, origin-guarded, and tied to a dedicated durable workflow", () => {
  assert.equal(existsSync(retryRouteUrl), true, "root-only targeted retry route must exist")
  assert.equal(existsSync(retryWorkflowUrl), true, "targeted retry workflow must exist")
  if (!existsSync(retryRouteUrl) || !existsSync(retryWorkflowUrl)) return

  const route = source("app/api/admin/qeoindex/eod/retry/route.ts")
  const retry = source("workflows/qeoindex-eod-retry.ts")
  assert.match(route, /requireApiRoot/)
  assert.match(route, /validateAdminMutationRequest/)
  assert.match(route, /start\(qeoindexEodRetry/)
  assert.match(retry, /status[\s\S]*partial/i)
  assert.match(retry, /selectRetryTickers/)
  assert.match(retry, /runTargetedHistoryRetryStep/)
  assert.match(retry, /runTargetedWyckoffRetryStep/)
  assert.match(retry, /revalidateFullCanonicalArtifactsStep/)
  assert.match(retry, /runSupabasePublishStep/)
  assert.match(retry, /runDeterministicCouncilStep[\s\S]*runMarketSynthesisStep[\s\S]*runLlmDebateStep/)
})
