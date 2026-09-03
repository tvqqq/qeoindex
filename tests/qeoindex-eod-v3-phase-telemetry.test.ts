import assert from "node:assert/strict"
import test from "node:test"

import { buildAdminJobPhaseTimeline, QEOINDEX_EOD_PHASES } from "../lib/admin/job-phases.ts"

const expected = [
  "KFSP_RATING_REFRESH",
  "TTAI_REFRESH",
  "MARKET_CLOSE_COLLECT",
  "EOD_READY",
  "HISTORY_REFRESH",
  "WYCKOFF_BUILD",
  "SUPABASE_VALIDATE",
  "SUPABASE_PUBLISH",
  "AI_COUNCIL_DETERMINISTIC",
  "AI_COUNCIL_LLM",
  "MARKET_SYNTHESIS",
  "NOTION_ARCHIVE",
  "RETENTION_CLEANUP",
  "COMPLETE",
]

test("EOD transitional v4 telemetry exposes same-session refresh before READY without Drive", () => {
  assert.deepEqual(QEOINDEX_EOD_PHASES.map((phase) => phase.key), expected)
  assert.deepEqual(QEOINDEX_EOD_PHASES.map((phase) => phase.order), expected.map((_, index) => index + 1))
})

test("missing EOD telemetry rows remain pending while persisted phases retain their result", () => {
  const timeline = buildAdminJobPhaseTimeline([
    {
      id: "phase-1",
      run_id: "run-1",
      job_key: "qeoindex.eod_pipeline",
      phase_key: "EOD_READY",
      phase_order: 4,
      status: "succeeded",
      started_at: "2026-09-01T08:15:00.000Z",
      finished_at: "2026-09-01T08:15:01.000Z",
      duration_ms: 1000,
      summary: { universeCount: 200 },
    },
  ])

  assert.deepEqual(timeline.map((phase) => phase.key), expected)
  assert.equal(timeline[0].status, "pending")
  assert.equal(timeline.find((phase) => phase.key === "EOD_READY")?.status, "succeeded")
  assert.equal(timeline.find((phase) => phase.key === "AI_COUNCIL_LLM")?.order, 10)
  assert.equal(timeline.find((phase) => phase.key === "RETENTION_CLEANUP")?.order, 13)
  assert.deepEqual(timeline.find((phase) => phase.key === "EOD_READY")?.summary, { universeCount: 200 })
})
