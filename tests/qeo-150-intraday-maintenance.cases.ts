import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  classifyQeo150Freshness,
  expectedCompletedVietnamSession,
  qeo150SessionRange,
} from "../modules/market/chart-data/maintenance-policy.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-150 expected completed session respects configured close, holidays, weekends and changed close", () => {
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-09T07:45:59.000Z")), "2026-09-08")
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-09T07:46:01.000Z")), "2026-09-09")
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-02T08:30:00.000Z")), "2026-08-28")
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-12T08:30:00.000Z")), "2026-09-11")
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-09T05:59:59.000Z"), { closeSeconds: 13 * 3600 }), "2026-09-08")
  assert.equal(expectedCompletedVietnamSession(new Date("2026-09-09T06:00:01.000Z"), { closeSeconds: 13 * 3600 }), "2026-09-09")
})

test("QEO-150 freshness requires exact expected-session identity; five old HOT sessions are stale", () => {
  const stale = classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-04",
    dailyEvidence: { volume: 1_250_000, provider: "VCI", providerDetail: null, sourceUrl: null },
    lastAttemptOutcome: "none",
  })
  assert.equal(stale.current, false)
  assert.equal(stale.evidenceCategory, "provider_gap")

  const current = classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-08",
    dailyEvidence: { volume: 1_250_000, provider: "VCI", providerDetail: null, sourceUrl: null },
    lastAttemptOutcome: "none",
  })
  assert.equal(current.current, true)
  assert.equal(current.evidenceCategory, "traded")
})

test("QEO-150 keeps no-trade, suspension, provider gap, failure and unknown distinct", () => {
  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: { volume: 0, provider: "DNSE", providerDetail: null, sourceUrl: null },
    lastAttemptOutcome: "none",
  }).evidenceCategory, "no_trade")

  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: { volume: 0, provider: "Fallback", providerDetail: "generic fallback", sourceUrl: null },
    lastAttemptOutcome: "none",
  }).evidenceCategory, "unknown")

  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: null,
    lastAttemptOutcome: "failed",
  }).evidenceCategory, "failure")

  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: null,
    lastAttemptOutcome: "provider_gap",
  }).evidenceCategory, "provider_gap")

  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: { volume: 0, provider: "VCI", providerDetail: "Trading suspended by exchange", sourceUrl: null },
    lastAttemptOutcome: "none",
  }).evidenceCategory, "suspension")

  assert.equal(classifyQeo150Freshness({
    expectedSession: "2026-09-08",
    actualSession: "2026-09-05",
    dailyEvidence: null,
    lastAttemptOutcome: "sla_timeout" as never,
  }).evidenceCategory, "failure")
})

test("QEO-150 session range is time-bounded but never assumes a fixed minute-bar count", () => {
  const range = qeo150SessionRange("2026-09-08")
  assert.equal(range.from, Math.floor(Date.parse("2026-09-08T09:00:00+07:00") / 1000))
  assert.equal(range.to, Math.floor(Date.parse("2026-09-08T14:46:00+07:00") / 1000))
  assert.ok(range.to > range.from)

  const policy = source("modules/market/chart-data/maintenance-policy.ts")
  assert.doesNotMatch(policy, /\b240\b/)
})

test("QEO-150 workflow reuses QEO-148 ingestion, isolates retries, checks capacity and never invokes bootstrap", () => {
  const steps = source("modules/market/chart-data/maintenance-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-maintenance.ts")
  const service = source("modules/market/chart-data/service.ts")

  assert.match(steps, /ingestClosedIntradayRange/)
  assert.match(steps, /readChartStorageCapacity/)
  assert.match(steps, /dispatchId/)
  assert.match(steps, /expectedSession/)
  assert.match(workflow, /QEO150_MAINTENANCE_BATCH_SIZE/)
  assert.match(workflow, /QEO150_MAX_RETRYABLE_ATTEMPTS/)
  assert.match(workflow, /Promise\.all/)
  assert.doesNotMatch(workflow, /chartIntradayBootstrapWorkflow|bootstrapChartIntradayChunk/)
  assert.match(service, /runClosedRangeIngestion/)
})

test("QEO-150 terminalizes remaining work at the SLA deadline and durably records dispatch-to-outcome identity", () => {
  const maintenance = source("modules/market/chart-data/maintenance.ts")
  const steps = source("modules/market/chart-data/maintenance-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-maintenance.ts")

  assert.match(maintenance, /recordQeo150OutcomeEvidence/)
  assert.match(maintenance, /dispatchId/)
  assert.match(steps, /slaDeadline/)
  assert.match(steps, /deadlineExceeded/)
  assert.match(steps, /checkChartIntradayMaintenanceExecutionGateStep/)
  assert.match(steps, /recordChartIntradayMaintenanceFailureStopStep/)
  assert.match(workflow, /checkChartIntradayMaintenanceExecutionGateStep/)
  assert.match(workflow, /recordChartIntradayMaintenanceFailureStopStep/)
  assert.match(workflow, /sla_timeout/)
  assert.doesNotMatch(workflow, /Date\.now\(|new Date\(/)
})

test("QEO-150 exposes authenticated maintenance/report modes and a bounded post-close scheduler", () => {
  const route = source("app/api/qeoindex/eod/route.ts")
  const migration = source("supabase/migrations/20260909173000_qeo150_chart_intraday_maintenance.sql")

  assert.match(route, /mode === "chart-maintenance"/)
  assert.match(route, /mode === "chart-maintenance-coverage"/)
  assert.match(route, /chartIntradayMaintenanceWorkflow/)
  assert.match(migration, /qeoindex-chart-intraday-maintenance-1450-ict/)
  assert.match(migration, /50 7 \* \* 1-5/)
  assert.match(migration, /mode=chart-maintenance/)
  assert.doesNotMatch(migration, /chart-bootstrap/)
})
