import assert from "node:assert/strict"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import { buildAdminJobViews } from "../lib/admin/job-health.ts"
import { resolveJobEvidence, type RawEvidenceSnapshot } from "../lib/admin/job-evidence.ts"

test("pg_cron enqueue success does not override execution failure for TTAI", () => {
  const ttaiDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.ttai_history")!
  assert.ok(ttaiDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [
      {
        jobId: 14,
        jobName: "kfsp-ttai-history-daily-1am-ict",
        schedule: "0 18 * * *",
        active: true,
        lastStatus: "succeeded", // pg_cron only dispatched the HTTP request
        lastStartedAt: "2026-08-26T07:17:00.000Z",
        lastFinishedAt: "2026-08-26T07:17:01.000Z",
      },
    ],
    kfspRatingRuns: [],
    kfspTtaiRuns: [
      {
        id: "ttai-run-1",
        status: "failed",
        latest_rating_date: "2026-08-26",
        candidate_count: 12,
        processed_count: 0,
        failed_count: 12,
        error_message: "HTTP 207 Multi-Status: all 12 candidate tickers failed provider query",
        started_at: "2026-08-26T07:17:01.000Z",
        completed_at: "2026-08-26T07:17:15.000Z",
      },
    ],
    orderbookStats: null,
  }

  const resolved = resolveJobEvidence(ttaiDef, evidence, new Date("2026-08-26T07:30:00.000Z"))

  assert.equal(resolved.schedulerStatus, "active")
  assert.equal(resolved.schedulerLastStatus, "succeeded")
  assert.equal(resolved.executionStatus, "failing")
  assert.match(resolved.healthReason, /Thất bại.*0\/12.*12.*lỗi/)
})

test("KFSP rating sync is recognized as healthy from kfsp_rating_sync_runs", () => {
  const ratingDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "kfsp.rating_daily")!
  assert.ok(ratingDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [
      {
        jobId: 12,
        jobName: "kfsp-rating-daily-7am-ict",
        schedule: "0 0 * * *",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-26T00:00:00.000Z",
        lastFinishedAt: "2026-08-26T00:00:02.000Z",
      },
    ],
    kfspRatingRuns: [
      {
        id: "rating-run-1",
        as_of_date: "2026-08-26",
        status: "completed",
        published_row_count: 1752,
        staged_row_count: 1752,
        error_code: null,
        error_message: null,
        started_at: "2026-08-26T00:00:02.000Z",
        completed_at: "2026-08-26T00:00:45.000Z",
      },
    ],
    kfspTtaiRuns: [],
    orderbookStats: null,
  }

  const resolved = resolveJobEvidence(ratingDef, evidence, new Date("2026-08-26T07:30:00.000Z"))

  assert.equal(resolved.schedulerStatus, "active")
  assert.equal(resolved.executionStatus, "healthy")
  assert.match(resolved.healthReason, /1752 mã.*2026-08-26/)
})

test("QeoIndex EOD pipeline without runs remains unknown/pending first run", () => {
  const eodDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "qeoindex.eod_pipeline")!
  assert.ok(eodDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [], // zero runs recorded in telemetry
    cronSnapshots: [
      {
        jobId: 20,
        jobName: "qeoindex-eod-pipeline-1515-ict",
        schedule: "15 8 * * 1-5",
        active: true,
        lastStatus: null,
        lastStartedAt: null,
        lastFinishedAt: null,
      },
    ],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: null,
  }

  const resolved = resolveJobEvidence(eodDef, evidence, new Date("2026-08-26T07:30:00.000Z"))

  assert.equal(resolved.schedulerStatus, "active")
  assert.equal(resolved.executionStatus, "unknown")
  assert.match(resolved.healthReason, /15:15 ICT/)
})

test("Signals Daily without system_job_runs remains unknown until telemetry completes", () => {
  const signalsDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "signals.daily")!
  assert.ok(signalsDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: null,
  }

  const resolved = resolveJobEvidence(signalsDef, evidence, new Date("2026-08-26T07:30:00.000Z"))

  assert.equal(resolved.schedulerStatus, "active")
  assert.equal(resolved.executionStatus, "unknown")
  assert.match(resolved.healthReason, /telemetry/)
})

test("arbitrarily old orderbook evidence (e.g. 5 days ago) is marked stale and not healthy", () => {
  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5mDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: {
      latestSessionDate: "2026-08-21",
      totalSnapshots: 100,
      latestUpdatedAt: "2026-08-21T07:50:00.000Z", // 5 days old
    },
  }

  // 20:00 ICT on Wednesday 2026-08-26 (13:00 UTC) -> Market closed (off-session)
  const now = new Date("2026-08-26T13:00:00.000Z")
  const resolved = resolveJobEvidence(sync5mDef, evidence, now)

  assert.equal(resolved.executionStatus, "stale", "Old orderbook evidence must be marked stale")
  assert.match(resolved.healthReason, /quá cũ/)
})

test("orderbook evidence during active market session with previous day session date is marked stale", () => {
  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5mDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: {
      latestSessionDate: "2026-08-25", // yesterday
      totalSnapshots: 100,
      latestUpdatedAt: "2026-08-25T07:50:00.000Z",
    },
  }

  // 10:00 ICT on Wednesday 2026-08-26 (03:00 UTC) -> Market is Open!
  const now = new Date("2026-08-26T03:00:00.000Z")
  const resolved = resolveJobEvidence(sync5mDef, evidence, now)

  assert.equal(resolved.executionStatus, "stale")
  assert.match(resolved.healthReason, /Chưa có snapshot cho phiên đang mở/)
})

test("orderbook evidence during active market session updated within 15 minutes is healthy", () => {
  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5mDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: {
      latestSessionDate: "2026-08-26",
      totalSnapshots: 100,
      latestUpdatedAt: "2026-08-26T02:55:00.000Z", // 5 minutes before 03:00 UTC
    },
  }

  const now = new Date("2026-08-26T03:00:00.000Z")
  const resolved = resolveJobEvidence(sync5mDef, evidence, now)

  assert.equal(resolved.executionStatus, "healthy")
  assert.match(resolved.healthReason, /100\/100 snapshot/)
})

test("orderbook evidence during active market session older than 15 minutes is stale", () => {
  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5mDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: {
      latestSessionDate: "2026-08-26",
      totalSnapshots: 100,
      latestUpdatedAt: "2026-08-26T02:30:00.000Z", // 30 minutes before 03:00 UTC (> 15m)
    },
  }

  const now = new Date("2026-08-26T03:00:00.000Z")
  const resolved = resolveJobEvidence(sync5mDef, evidence, now)

  assert.equal(resolved.executionStatus, "stale")
  assert.match(resolved.healthReason, /quá hạn/)
})

test("orderbook evidence with low snapshot count is degraded", () => {
  const sync5mDef = EFFECTIVE_ADMIN_JOB_CATALOG.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5mDef)

  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: {
      latestSessionDate: "2026-08-26",
      totalSnapshots: 25, // Less than 50
      latestUpdatedAt: "2026-08-26T02:55:00.000Z",
    },
  }

  const now = new Date("2026-08-26T03:00:00.000Z")
  const resolved = resolveJobEvidence(sync5mDef, evidence, now)

  assert.equal(resolved.executionStatus, "degraded")
  assert.match(resolved.healthReason, /không đầy đủ/)
})

test("buildAdminJobViews calculates counts and sets conflict warning on views", () => {
  const evidence: RawEvidenceSnapshot = {
    systemJobRuns: [
      {
        id: "run-scanner",
        job_key: "scanner.run",
        trigger: "manual",
        status: "succeeded",
        started_at: "2026-08-26T06:00:00.000Z",
        finished_at: "2026-08-26T06:01:00.000Z",
        duration_ms: 60000,
        summary: { completed: 100 },
      },
    ],
    cronSnapshots: [
      {
        jobId: 12,
        jobName: "kfsp-rating-daily-7am-ict",
        schedule: "0 0 * * *",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-26T00:00:00.000Z",
        lastFinishedAt: "2026-08-26T00:00:02.000Z",
      },
      {
        jobId: 14,
        jobName: "kfsp-ttai-history-daily-1am-ict",
        schedule: "0 18 * * *",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-26T07:17:00.000Z",
        lastFinishedAt: "2026-08-26T07:17:01.000Z",
      },
      {
        jobId: 15,
        jobName: "sync-universe-5m",
        schedule: "*/5 2-7 * * 1-5",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-26T07:00:00.000Z",
        lastFinishedAt: "2026-08-26T07:00:01.000Z",
      },
      {
        jobId: 16,
        jobName: "sync-universe-eod-1450",
        schedule: "50 7 * * 1-5",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-25T07:50:00.000Z",
        lastFinishedAt: "2026-08-25T07:50:01.000Z",
      },
      {
        jobId: 20,
        jobName: "qeoindex-eod-pipeline-1515-ict",
        schedule: "15 8 * * 1-5",
        active: true,
        lastStatus: null,
        lastStartedAt: null,
        lastFinishedAt: null,
      },
    ],
    kfspRatingRuns: [
      {
        id: "rating-1",
        as_of_date: "2026-08-26",
        status: "completed",
        published_row_count: 1752,
        staged_row_count: 1752,
        error_code: null,
        error_message: null,
        started_at: "2026-08-26T00:00:00.000Z",
        completed_at: "2026-08-26T00:00:30.000Z",
      },
    ],
    kfspTtaiRuns: [
      {
        id: "ttai-1",
        status: "failed",
        latest_rating_date: "2026-08-26",
        candidate_count: 12,
        processed_count: 0,
        failed_count: 12,
        error_message: "HTTP 207 Multi-Status",
        started_at: "2026-08-26T07:17:00.000Z",
        completed_at: "2026-08-26T07:17:10.000Z",
      },
    ],
    orderbookStats: {
      latestSessionDate: "2026-08-26",
      totalSnapshots: 100,
      latestUpdatedAt: "2026-08-26T07:50:00.000Z",
    },
  }

  // 15:30 ICT on 2026-08-26 (08:30 UTC) - after market close, fresh today's data
  const { jobs, counts } = buildAdminJobViews(
    EFFECTIVE_ADMIN_JOB_CATALOG,
    evidence,
    [],
    new Date("2026-08-26T08:30:00.000Z"),
  )

  const sync5m = jobs.find((j) => j.key === "market.sync_5m")!
  assert.ok(sync5m)
  assert.equal(sync5m.conflictWarning, null, "Resolved 14:45 schedule must have zero conflict warning")

  const ttai = jobs.find((j) => j.key === "kfsp.ttai_history")!
  assert.ok(ttai)
  assert.equal(ttai.status, "failing")
  assert.equal(ttai.executionStatus, "failing")
  assert.equal(ttai.schedulerStatus, "active")

  assert.ok(counts.failing >= 1)
  assert.ok(counts.healthy >= 2) // kfsp rating + market sync 5m + market sync eod + scanner
})
