import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"

const moduleUrl = new URL("../lib/admin/job-phase-telemetry.ts", import.meta.url)

test("QeoIndex EOD phase telemetry persists running then succeeded with canonical metadata", async () => {
  assert.equal(existsSync(moduleUrl), true, "job-phase-telemetry.ts must exist")
  if (!existsSync(moduleUrl)) return

  const { runQeoIndexEodPhase } = await import("../lib/admin/job-phase-telemetry.ts")
  const writes: Array<Record<string, unknown>> = []
  const io = {
    upsertPhase: async (row: Record<string, unknown>) => {
      writes.push(structuredClone(row))
    },
  }

  const result = await runQeoIndexEodPhase({
    runId: "11111111-1111-4111-8111-111111111111",
    phaseKey: "WYCKOFF_BUILD",
    io,
    fn: async () => ({ snapshots: 500, secret: "safe-summary" }),
    summarize: (value: { snapshots: number }) => ({ snapshots: value.snapshots }),
  })

  assert.equal(result.snapshots, 500)
  assert.deepEqual(writes.map((row) => row.status), ["running", "succeeded"])
  assert.equal(writes[0].job_key, "qeoindex.eod_pipeline")
  assert.equal(writes[0].phase_key, "WYCKOFF_BUILD")
  assert.equal(writes[0].phase_order, 4)
  assert.deepEqual(writes[1].summary, { snapshots: 500 })
  assert.equal(typeof writes[1].finished_at, "string")
  assert.equal(typeof writes[1].duration_ms, "number")
  assert.equal(writes[1].error_code, null)
  assert.equal(writes[1].error_message, null)
})

test("QeoIndex EOD phase telemetry records failure and rethrows the original error", async () => {
  assert.equal(existsSync(moduleUrl), true, "job-phase-telemetry.ts must exist")
  if (!existsSync(moduleUrl)) return

  const { runQeoIndexEodPhase } = await import("../lib/admin/job-phase-telemetry.ts")
  const writes: Array<Record<string, unknown>> = []
  const io = { upsertPhase: async (row: Record<string, unknown>) => { writes.push(structuredClone(row)) } }
  const failure = Object.assign(new Error("provider failed"), { code: "UPSTREAM_STALE" })

  await assert.rejects(
    () => runQeoIndexEodPhase({
      runId: "22222222-2222-4222-8222-222222222222",
      phaseKey: "HISTORY_REFRESH",
      io,
      fn: async () => { throw failure },
    }),
    (error: unknown) => error === failure,
  )

  assert.deepEqual(writes.map((row) => row.status), ["running", "failed"])
  assert.equal(writes[1].error_code, "UPSTREAM_STALE")
  assert.equal(writes[1].error_message, "provider failed")
  assert.equal(writes[1].phase_order, 3)
})

test("QeoIndex EOD phase telemetry can mark skipped phases without executing work", async () => {
  assert.equal(existsSync(moduleUrl), true, "job-phase-telemetry.ts must exist")
  if (!existsSync(moduleUrl)) return

  const { markQeoIndexEodPhaseSkipped } = await import("../lib/admin/job-phase-telemetry.ts")
  const writes: Array<Record<string, unknown>> = []
  const io = { upsertPhase: async (row: Record<string, unknown>) => { writes.push(structuredClone(row)) } }

  await markQeoIndexEodPhaseSkipped({
    runId: "33333333-3333-4333-8333-333333333333",
    phaseKey: "AI_COUNCIL_LLM",
    reason: "deterministic gate did not pass",
    io,
  })

  assert.equal(writes.length, 1)
  assert.equal(writes[0].status, "skipped")
  assert.equal(writes[0].phase_order, 10)
  assert.deepEqual(writes[0].summary, { reason: "deterministic gate did not pass" })
})

test("QeoIndex EOD phase telemetry fails closed when telemetry persistence fails", async () => {
  assert.equal(existsSync(moduleUrl), true, "job-phase-telemetry.ts must exist")
  if (!existsSync(moduleUrl)) return

  const { runQeoIndexEodPhase } = await import("../lib/admin/job-phase-telemetry.ts")
  let executed = false
  const io = { upsertPhase: async () => { throw new Error("telemetry unavailable") } }

  await assert.rejects(
    () => runQeoIndexEodPhase({
      runId: "44444444-4444-4444-8444-444444444444",
      phaseKey: "EOD_READY",
      io,
      fn: async () => { executed = true; return true },
    }),
    /telemetry unavailable/,
  )
  assert.equal(executed, false)
})
