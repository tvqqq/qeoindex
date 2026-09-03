import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"
import { buildAdminJobViews } from "../lib/admin/job-health.ts"
import { buildCronTimelineModel, EOD_PIPELINE_PHASES } from "../lib/admin/cron-timeline.ts"
import type { AdminJobView } from "../lib/admin/types.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("buildCronTimelineModel separates scheduled automation, manual recovery, and disabled maintenance", () => {
  const { jobs } = buildAdminJobViews(
    EFFECTIVE_ADMIN_JOB_CATALOG,
    [
      {
        id: "run-eod",
        job_key: "qeoindex.eod_pipeline",
        trigger: "workflow",
        status: "succeeded",
        started_at: "2026-08-25T08:15:00.000Z",
        finished_at: "2026-08-25T08:20:00.000Z",
      },
    ],
    [
      {
        jobId: 20,
        jobName: "qeoindex-eod-pipeline-1515-ict",
        schedule: "15 8 * * 1-5",
        active: true,
        lastStatus: "succeeded",
        lastStartedAt: "2026-08-25T08:15:00.000Z",
        lastFinishedAt: "2026-08-25T08:15:02.000Z",
      },
    ],
  )

  const timeline = buildCronTimelineModel(jobs)

  assert.equal(timeline.lanes.length, 4)
  assert.equal(timeline.lanes[0].id, "vercel")
  assert.equal(timeline.lanes[1].id, "pg_cron")
  assert.equal(timeline.lanes[2].id, "manual")
  assert.equal(timeline.lanes[3].id, "disabled")

  const vercelJob = timeline.lanes[0].jobs.find((j) => j.key === "signals.daily")
  assert.ok(vercelJob)
  assert.equal(vercelJob.timeIctLabel, "07:00 ICT")
  assert.equal(vercelJob.daysLabel, "T2-T6")

  const eodJob = timeline.lanes[1].jobs.find((j) => j.key === "qeoindex.eod_pipeline")
  assert.ok(eodJob)
  assert.equal(eodJob.timeIctLabel, "15:15 ICT")
  assert.equal(eodJob.phases?.length, 12)
  assert.deepEqual(eodJob.phases?.map((p) => p.key), EOD_PIPELINE_PHASES.map((p) => p.key))
  assert.equal(eodJob.phases?.some((p) => p.key === "DRIVE_ARCHIVE"), false)

  const sync5m = timeline.lanes[1].jobs.find((j) => j.key === "market.sync_5m")
  assert.ok(sync5m)
  assert.equal(sync5m.displayType, "interval")
  assert.match(sync5m.timeIctLabel, /09:00.*11:30.*13:00.*14:40/)

  const syncEod = timeline.lanes[1].jobs.find((j) => j.key === "market.sync_eod")
  assert.ok(syncEod)
  assert.equal(syncEod.displayType, "point")
  assert.equal(syncEod.timeIctLabel, "14:45 ICT")

  const scheduledTtai = timeline.lanes[1].jobs.find((j) => j.key === "kfsp.ttai_history")
  assert.ok(scheduledTtai)
  assert.equal(scheduledTtai.displayType, "point")
  assert.equal(scheduledTtai.timeIctLabel, "07:10 ICT")
  assert.equal(scheduledTtai.startMinuteOfDay, 430)

  const recoveryKeys = timeline.lanes[2].jobs.map((job) => job.key).sort()
  assert.deepEqual(recoveryKeys, [
    "kfsp.rating_daily",
    "kfsp.ttai_history",
    "market.sync_universe",
    "scanner.run",
    "signals.monitor",
    "wyckoff.ingest",
  ])

  const scanner = timeline.lanes[2].jobs.find((j) => j.key === "scanner.run")
  assert.ok(scanner)
  assert.equal(scanner.displayType, "manual")
  assert.equal(scanner.manualPurpose, "recovery")
  assert.deepEqual(scanner.automatedParentKeys, ["signals.daily"])

  const recoveryTtai = timeline.lanes[2].jobs.find((j) => j.key === "kfsp.ttai_history")
  assert.ok(recoveryTtai)
  assert.equal(recoveryTtai.manualPurpose, "recovery")
  assert.equal(recoveryTtai.timeIctLabel, "07:10 ICT")

  const disabledKeys = timeline.lanes[3].jobs.map((job) => job.key).sort()
  assert.deepEqual(disabledKeys, ["market.cache_invalidate", "wyckoff.run"])
  assert.equal(timeline.totalManual, 6)
})

test("manual recovery lane is backed by the dispatch allowlist, not manualPolicy alone", () => {
  const fakeManualJob: AdminJobView = {
    key: "internal.not_allowlisted",
    provider: "machine",
    label: "Internal Test Job",
    description: "Must not render as runnable recovery.",
    group: "system",
    scheduleKind: "manual",
    manualPolicy: "allowed",
    manualPurpose: "recovery",
    status: "unknown",
    schedulerStatus: "unscheduled",
    evidenceSource: "none",
    schedulePolicy: { kind: "manual", timezone: "Asia/Ho_Chi_Minh" },
  }

  const timeline = buildCronTimelineModel([fakeManualJob])
  assert.equal(timeline.lanes.find((lane) => lane.id === "manual")?.jobs.length, 0)
  assert.equal(timeline.totalManual, 0)
})

test("daily signals scans the full canonical universe instead of a positional Top50 subset", () => {
  const workflow = source("workflows/daily-signal-workflow.ts")
  const scannerRunner = source("lib/scanner-runner.ts")

  assert.match(workflow, /return runScannerUniverse\(\)/)
  assert.doesNotMatch(workflow, /runScannerUniverse\(\{\s*limit:\s*50/)
  assert.doesNotMatch(scannerRunner, /100 cache invalidations/)
})

test("QEO-47 preserves canonical Wyckoff five-timeframe snapshot semantics", () => {
  const catalog = source("lib/admin/catalog.ts")
  const settings = source("lib/admin/settings.ts")

  assert.doesNotMatch(catalog, /2 timeframe active/)
  assert.doesNotMatch(settings, /2 timeframe active/)
  assert.match(catalog, /200 mã × 5 timeframe/)
  assert.match(settings, /200 mã × 5 timeframe/)
  assert.match(catalog, /defaultValue:\s*1_000/)
  assert.match(settings, /defaultValue:\s*1_000/)
})

test("Admin timeline table is built from lane rows so manual recovery duplicates remain visible", () => {
  const timelineComponent = source("components/admin/admin-cron-timeline.tsx")

  assert.match(timelineComponent, /timeline\.lanes\.flatMap/)
  assert.match(timelineComponent, /laneId/)
  assert.match(timelineComponent, /key=\{`\$\{laneId\}:\$\{node\.key\}`\}/)
})

test("Timeline component adheres to UI Lessons Learned performance constraints", () => {
  const timelineComponent = source("components/admin/admin-cron-timeline.tsx")
  const summaryComponent = source("components/admin/admin-job-audit-summary.tsx")

  assert.equal(timelineComponent.includes("backdrop-blur"), false, "Timeline must not use backdrop-blur")
  assert.equal(timelineComponent.includes("backdrop-filter"), false, "Timeline must not use backdrop-filter")
  assert.equal(summaryComponent.includes("backdrop-blur"), false, "Summary must not use backdrop-blur")
  assert.equal(timelineComponent.includes("drop-shadow"), false, "Timeline must not use drop-shadow")
  assert.equal(timelineComponent.includes("transition-all"), false, "Timeline must not use transition-all")
  assert.equal(summaryComponent.includes("transition-all"), false, "Summary must not use transition-all")

  const linkMatches = [...timelineComponent.matchAll(/<Link\s+[^>]*>/g)]
  for (const match of linkMatches) {
    assert.match(match[0], /prefetch=\{false\}/, `Every Link must specify prefetch={false}: ${match[0]}`)
  }

  assert.match(timelineComponent, /aria-label="Danh sách tác vụ tuần tự chi tiết"/)
  assert.match(timelineComponent, /<table/)
  assert.match(timelineComponent, /Manual recovery/i)
  assert.match(timelineComponent, /Automated by:/)
  assert.match(timelineComponent, /Manual disabled/i)
  assert.equal(summaryComponent.includes('"HTTP 207"'), false, "Summary must not hardcode 'HTTP 207'")
  assert.match(summaryComponent, /j\.lastErrorCode/)
  assert.match(summaryComponent, /Không có tác vụ nào lỗi/)
  assert.match(summaryComponent, /Không có xung đột lịch chạy nào/)
  assert.match(summaryComponent, /conflictJobs\.map/)
})
