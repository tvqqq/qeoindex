import assert from "node:assert/strict"
import test from "node:test"

import {
  failSignalsDailyRunStep,
  finishSignalsDailyRunStep,
  SIGNALS_DAILY_JOB_KEY,
  SIGNALS_DAILY_PROVIDER,
  startSignalsDailyRunStep,
  type SignalsDailyTelemetryIo,
} from "../lib/signals-daily-telemetry.ts"

test("startSignalsDailyRunStep persists running run with canonical job metadata", async () => {
  const insertCalls: Array<Record<string, unknown>> = []
  const io: SignalsDailyTelemetryIo = {
    insertRun: async (row) => {
      insertCalls.push(structuredClone(row))
      return "signals-run-1"
    },
    updateRun: async () => {},
  }

  const runId = await startSignalsDailyRunStep("2026-08-26T00:00:00.000Z", io)

  assert.equal(runId, "signals-run-1")
  assert.equal(insertCalls.length, 1)
  assert.equal(insertCalls[0].job_key, SIGNALS_DAILY_JOB_KEY)
  assert.equal(insertCalls[0].provider, SIGNALS_DAILY_PROVIDER)
  assert.equal(insertCalls[0].trigger, "workflow")
  assert.equal(insertCalls[0].status, "running")
  assert.equal(insertCalls[0].started_at, "2026-08-26T00:00:00.000Z")
})

test("signals daily stage telemetry persists meaningful durable-wait progress", async () => {
  const telemetry = await import("../lib/signals-daily-telemetry.ts") as Record<string, unknown>
  const updateStage = telemetry.updateSignalsDailyStageStep as ((
    runId: string,
    stage: string,
    details: Record<string, unknown>,
    io: SignalsDailyTelemetryIo,
  ) => Promise<unknown>) | undefined

  assert.equal(typeof updateStage, "function")

  const updateCalls: Array<{ runId: string; updates: Record<string, unknown> }> = []
  const io: SignalsDailyTelemetryIo = {
    insertRun: async () => "run-id",
    updateRun: async (runId, updates) => {
      updateCalls.push({ runId, updates: structuredClone(updates) })
    },
  }

  await updateStage!(
    "signals-run-stage",
    "WAIT_OPEN",
    {
      nextWakeAt: "2026-08-26T02:15:05.000Z",
      scanner: { completed: 48, skipped: 1, errors: 1 },
    },
    io,
  )

  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].runId, "signals-run-stage")
  assert.deepEqual(updateCalls[0].updates.summary, {
    stage: "WAIT_OPEN",
    nextWakeAt: "2026-08-26T02:15:05.000Z",
    scanner: { completed: 48, skipped: 1, errors: 1 },
  })
})

test("finishSignalsDailyRunStep updates run to succeeded with sanitized summary and duration", async () => {
  const updateCalls: Array<{ runId: string; updates: Record<string, unknown> }> = []
  const io: SignalsDailyTelemetryIo = {
    insertRun: async () => "run-id",
    updateRun: async (runId, updates) => {
      updateCalls.push({ runId, updates: structuredClone(updates) })
    },
  }

  const startedAt = new Date(Date.now() - 5000).toISOString()
  const result = await finishSignalsDailyRunStep(
    "signals-run-2",
    startedAt,
    { dateKey: "2026-08-26", openAtClose: 3, scanner: { completed: 50, skipped: 0, errors: 0 } },
    io,
  )

  assert.equal(result.ok, true)
  assert.equal(result.status, "succeeded")
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].runId, "signals-run-2")
  assert.equal(updateCalls[0].updates.status, "succeeded")
  assert.equal(typeof updateCalls[0].updates.duration_ms, "number")
  assert.ok((updateCalls[0].updates.duration_ms as number) >= 0)
  assert.deepEqual(updateCalls[0].updates.summary, {
    dateKey: "2026-08-26",
    openAtClose: 3,
    scanner: { completed: 50, skipped: 0, errors: 0 },
  })
})

test("failSignalsDailyRunStep updates run to failed with error code and message", async () => {
  const updateCalls: Array<{ runId: string; updates: Record<string, unknown> }> = []
  const io: SignalsDailyTelemetryIo = {
    insertRun: async () => "run-id",
    updateRun: async (runId, updates) => {
      updateCalls.push({ runId, updates: structuredClone(updates) })
    },
  }

  const startedAt = new Date(Date.now() - 3000).toISOString()
  const result = await failSignalsDailyRunStep(
    "signals-run-3",
    startedAt,
    "DNSE provider socket connection timed out",
    io,
  )

  assert.equal(result.ok, true)
  assert.equal(result.status, "failed")
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].runId, "signals-run-3")
  assert.equal(updateCalls[0].updates.status, "failed")
  assert.equal(updateCalls[0].updates.error_code, "SIGNALS_DAILY_FAILED")
  assert.equal(updateCalls[0].updates.error_message, "DNSE provider socket connection timed out")
})
