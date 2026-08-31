import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  ALLOWLISTED_MANUAL_JOB_KEYS,
  getManualJobCapabilities,
  isManualJobAllowed,
} from "../lib/admin/jobs.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("only the 4 allowlisted jobs are manual-safe", () => {
  assert.deepEqual([...ALLOWLISTED_MANUAL_JOB_KEYS].sort(), [
    "market.sync_universe",
    "scanner.run",
    "signals.monitor",
    "wyckoff.ingest",
  ])

  assert.equal(isManualJobAllowed("market.sync_universe"), true)
  assert.equal(isManualJobAllowed("scanner.run"), true)
  assert.equal(isManualJobAllowed("signals.monitor"), true)
  assert.equal(isManualJobAllowed("wyckoff.ingest"), true)
  assert.equal(isManualJobAllowed("ai_council.daily"), false)
  assert.equal(isManualJobAllowed("ai_council.debate_daily"), false)
  assert.equal(isManualJobAllowed("signals.daily"), false)
  assert.equal(isManualJobAllowed("arbitrary.job"), false)
})

test("getManualJobCapabilities returns metadata for the 4 manual-safe jobs", () => {
  const capabilities = getManualJobCapabilities()
  assert.equal(capabilities.length, 4)
  const keys = capabilities.map((c) => c.key).sort()
  assert.deepEqual(keys, [
    "market.sync_universe",
    "scanner.run",
    "signals.monitor",
    "wyckoff.ingest",
  ])
})

test("dispatchManualAdminJob rejects un-allowlisted jobs with error", async () => {
  const { dispatchManualAdminJob } = await import("../lib/admin/jobs.ts")
  const result = await dispatchManualAdminJob({
    key: "ai_council.daily",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    reason: "Thử nghiệm chạy job không được phép",
    requestId: "req-1",
  })

  assert.equal(result.ok, false)
  assert.match(result.error || "", /không cho phép chạy thủ công/)
})

test("dispatchManualAdminJob rejects short change reason", async () => {
  const { dispatchManualAdminJob } = await import("../lib/admin/jobs.ts")
  const result = await dispatchManualAdminJob({
    key: "scanner.run",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    reason: "short",
    requestId: "req-2",
  })

  assert.equal(result.ok, false)
  assert.match(result.error || "", /8 đến 240 ký tự/)
})

test("AI Council operations hard-stop on stale EOD upstream evidence before persistence or LLM freeze", () => {
  const daily = source("app/api/ai-council/daily/route.ts")
  const debate = source("app/api/ai-council/debate-daily/route.ts")
  const operations = source("lib/ai-council-operations.ts")

  assert.match(daily, /runAiCouncilDailyOperation/)
  assert.match(debate, /runAiCouncilDebateOperation/)
  assert.match(daily, /isMachineRequestAuthorized/)
  assert.match(debate, /isMachineRequestAuthorized/)
  assert.match(operations, /assertAiCouncilEodFreshness/)
  assert.match(operations, /UPSTREAM_STALE/)

  const dailyStart = operations.indexOf("export async function runAiCouncilDailyOperation")
  const debateStart = operations.indexOf("export async function runAiCouncilDebateOperation")
  assert.ok(dailyStart >= 0 && debateStart > dailyStart, "operation boundaries must be discoverable")

  const dailyBody = operations.slice(dailyStart, debateStart)
  const debateBody = operations.slice(debateStart)

  const dailyGuard = dailyBody.indexOf("freshness = await assertAiCouncilEodFreshness")
  const dailyPersist = dailyBody.indexOf("persistAiCouncilData")
  assert.ok(dailyGuard >= 0 && dailyGuard < dailyPersist, "daily freshness gate must run before persistence")

  const debateGuard = debateBody.indexOf("freshness = await assertAiCouncilEodFreshness")
  const debateEnrichment = debateBody.indexOf("const evidenceFidelity = await enrichCouncilStocksForDebate")
  assert.ok(debateGuard >= 0 && debateGuard < debateEnrichment, "debate freshness gate must run before evidence freeze or OpenAI work")
})

test("machine manual domain routes persist one bounded system-job lifecycle", () => {
  for (const file of [
    "app/api/market/sync-universe/route.ts",
    "app/api/scanner/run/route.ts",
    "app/api/signals/monitor/route.ts",
    "app/api/wyckoff/ingest/route.ts",
  ]) {
    const code = source(file)
    assert.match(code, /executeSystemJob/)
    assert.match(code, /telemetry: "required"/)
    assert.match(code, /trigger: "external"/)
  }
  assert.match(source("app/api/signals/monitor/route.ts"), /terminalUpdateFailure: "preserve-domain-success"/)
})

test("telemetry wrapper keeps unsuccessful results out of succeeded state", () => {
  const telemetry = source("lib/admin/job-telemetry.ts")
  assert.match(telemetry, /isSuccess\?: \(result: T\) => boolean/)
  assert.match(telemetry, /input\.isSuccess && !input\.isSuccess\(result\)/)
  assert.match(telemetry, /Job success telemetry could not be persisted/)
})

test("telemetry lifecycle inserts once and finalizes once for success, result failure, and throw", async () => {
  const { executeSystemJob } = await import("../lib/admin/job-telemetry.ts")
  const makeClient = (opts: { insertError?: boolean; updateError?: boolean } = {}) => {
    const calls: string[] = []
    const client = {
      calls,
      from: () => ({
        insert: () => {
          calls.push("insert")
          return { select: () => ({ single: async () => ({ data: opts.insertError ? null : { id: "run-1" }, error: opts.insertError ? new Error("insert failed") : null }) }) }
        },
        update: () => ({ eq: async () => { calls.push("update"); return { error: opts.updateError ? new Error("update failed") : null } } }),
      }),
    }
    return client
  }

  const successClient = makeClient()
  const success = await executeSystemJob({ jobKey: "scanner.run", trigger: "external", telemetry: "required", telemetryClient: successClient, fn: async () => ({ ok: true }) })
  assert.equal(success.runId, "run-1")
  assert.deepEqual(successClient.calls, ["insert", "update"])

  const resultFailureClient = makeClient()
  await assert.rejects(() => executeSystemJob({ jobKey: "scanner.run", trigger: "external", telemetry: "required", telemetryClient: resultFailureClient, fn: async () => ({ ok: false }), isSuccess: (value) => value.ok }))
  assert.deepEqual(resultFailureClient.calls, ["insert", "update"])

  const throwClient = makeClient()
  await assert.rejects(() => executeSystemJob({ jobKey: "scanner.run", trigger: "external", telemetry: "required", telemetryClient: throwClient, fn: async () => { throw new Error("domain failure") } }))
  assert.deepEqual(throwClient.calls, ["insert", "update"])

  const insertFailureClient = makeClient({ insertError: true })
  let callbackCalled = false
  await assert.rejects(() => executeSystemJob({ jobKey: "scanner.run", trigger: "external", telemetry: "required", telemetryClient: insertFailureClient, fn: async () => { callbackCalled = true; return { ok: true } } }))
  assert.equal(callbackCalled, false)

  const updateFailureClient = makeClient({ updateError: true })
  await assert.rejects(() => executeSystemJob({ jobKey: "scanner.run", trigger: "external", telemetry: "required", telemetryClient: updateFailureClient, fn: async () => ({ ok: true }) }))
})

test("Signals Monitor preserves a successful domain response when terminal telemetry update fails", async () => {
  const { executeSystemJob } = await import("../lib/admin/job-telemetry.ts")
  const calls: string[] = []
  let domainCalls = 0
  const warnings: unknown[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const client = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "signals-run" }, error: null }) }) }),
        update: () => ({ eq: async () => { calls.push("update"); return { error: new Error("secret database detail") } } }),
      }),
    }
    const result = await executeSystemJob({
      jobKey: "signals.monitor", trigger: "external", telemetry: "required", terminalUpdateFailure: "preserve-domain-success", telemetryClient: client,
      fn: async () => { domainCalls += 1; return { ok: true } },
    })
    assert.deepEqual(result.result, { ok: true })
    assert.equal(domainCalls, 1)
    assert.deepEqual(calls, ["update"])
    assert.equal(warnings.length, 1)
    assert.doesNotMatch(JSON.stringify(warnings), /secret database detail/)
  } finally {
    console.warn = originalWarn
  }
})
