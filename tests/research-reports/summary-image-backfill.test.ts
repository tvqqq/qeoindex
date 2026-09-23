import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  normalizeResearchReportSummaryImageBackfillMaxReports,
  selectResearchReportSummaryImageBackfillCandidates,
} from "../../modules/research-reports/summary-image-backfill.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

const baseReport = {
  provider: "topi",
  external_report_id: "external",
  publish_date: "2026-09-20",
  pdf_url: "https://cdn02.wigroup.vn/report.pdf",
  analysis_status: "ready",
}

test("QEO-275 selects only current analyzed reports that still need a summary image", () => {
  const reports = [
    {
      ...baseReport,
      id: "pending",
      external_report_id: "pending-ext",
      publish_date: "2026-09-23",
      content_hash: "a".repeat(64),
      summary_image_status: "pending",
      summary_image_path: null,
      summary_image_analysis_id: null,
    },
    {
      ...baseReport,
      id: "current-ready",
      external_report_id: "ready-ext",
      publish_date: "2026-09-22",
      content_hash: "b".repeat(64),
      summary_image_status: "ready",
      summary_image_path: "current-ready/a2.png",
      summary_image_analysis_id: "a2",
    },
    {
      ...baseReport,
      id: "generating",
      external_report_id: "generating-ext",
      publish_date: "2026-09-21",
      content_hash: "c".repeat(64),
      summary_image_status: "generating",
      summary_image_path: null,
      summary_image_analysis_id: null,
    },
    {
      ...baseReport,
      id: "old-image",
      external_report_id: "old-ext",
      publish_date: "2026-09-20",
      content_hash: "d".repeat(64),
      summary_image_status: "ready",
      summary_image_path: "old-image/old-analysis.png",
      summary_image_analysis_id: "old-analysis",
    },
    {
      ...baseReport,
      id: "failed",
      external_report_id: "failed-ext",
      publish_date: "2026-09-19",
      content_hash: "e".repeat(64),
      summary_image_status: "failed",
      summary_image_path: null,
      summary_image_analysis_id: null,
    },
    {
      ...baseReport,
      id: "stale-analysis-only",
      external_report_id: "stale-ext",
      publish_date: "2026-09-18",
      content_hash: "f".repeat(64),
      summary_image_status: "pending",
      summary_image_path: null,
      summary_image_analysis_id: null,
    },
  ]

  const analyses = [
    { id: "a1", report_id: "pending", content_hash: "a".repeat(64), processed_at: "2026-09-23T01:00:00Z", created_at: "2026-09-23T01:00:00Z" },
    { id: "a2", report_id: "current-ready", content_hash: "b".repeat(64), processed_at: "2026-09-22T01:00:00Z", created_at: "2026-09-22T01:00:00Z" },
    { id: "a3", report_id: "generating", content_hash: "c".repeat(64), processed_at: "2026-09-21T01:00:00Z", created_at: "2026-09-21T01:00:00Z" },
    { id: "new-analysis", report_id: "old-image", content_hash: "d".repeat(64), processed_at: "2026-09-20T02:00:00Z", created_at: "2026-09-20T02:00:00Z" },
    { id: "old-analysis", report_id: "old-image", content_hash: "d".repeat(64), processed_at: "2026-09-20T01:00:00Z", created_at: "2026-09-20T01:00:00Z" },
    { id: "a5", report_id: "failed", content_hash: "e".repeat(64), processed_at: "2026-09-19T01:00:00Z", created_at: "2026-09-19T01:00:00Z" },
    { id: "stale", report_id: "stale-analysis-only", content_hash: "0".repeat(64), processed_at: "2026-09-18T01:00:00Z", created_at: "2026-09-18T01:00:00Z" },
  ]

  const prepared = selectResearchReportSummaryImageBackfillCandidates(reports, analyses, 100)

  assert.deepEqual(prepared.selected.map((row) => row.id), ["pending", "old-image", "failed"])
  assert.equal(prepared.selected.find((row) => row.id === "old-image")?.analysisId, "new-analysis")
  assert.equal(prepared.skippedReadyCurrent, 1)
  assert.equal(prepared.skippedGenerating, 1)
  assert.equal(prepared.missingCurrentAnalysis, 1)
  assert.equal(prepared.hasMore, false)
})

test("QEO-275 keeps image backfill bounded and reports remaining eligible work", () => {
  assert.equal(normalizeResearchReportSummaryImageBackfillMaxReports(undefined), 20)
  assert.equal(normalizeResearchReportSummaryImageBackfillMaxReports(100), 100)
  assert.throws(() => normalizeResearchReportSummaryImageBackfillMaxReports(0), /1 to 100/)
  assert.throws(() => normalizeResearchReportSummaryImageBackfillMaxReports(101), /1 to 100/)

  const reports = [1, 2, 3].map((index) => ({
    ...baseReport,
    id: `report-${index}`,
    external_report_id: `ext-${index}`,
    publish_date: `2026-09-${String(24 - index).padStart(2, "0")}`,
    content_hash: String(index).repeat(64),
    summary_image_status: "pending",
    summary_image_path: null,
    summary_image_analysis_id: null,
  }))
  const analyses = reports.map((report, index) => ({
    id: `analysis-${index + 1}`,
    report_id: report.id,
    content_hash: report.content_hash,
    processed_at: `2026-09-${String(24 - index).padStart(2, "0")}T01:00:00Z`,
    created_at: `2026-09-${String(24 - index).padStart(2, "0")}T01:00:00Z`,
  }))

  const prepared = selectResearchReportSummaryImageBackfillCandidates(reports, analyses, 2)
  assert.equal(prepared.selected.length, 2)
  assert.equal(prepared.hasMore, true)
})

test("QEO-275 production backfill is durable, machine authenticated, and image-only", () => {
  const workflow = source("workflows/research-report-summary-image-backfill-workflow.ts")
  const route = source("app/api/research-reports/images/backfill/route.ts")
  const steps = source("modules/research-reports/summary-image-backfill.ts")

  assert.match(workflow, /"use workflow"/)
  assert.match(workflow, /research_reports\.image_backfill/)
  assert.match(workflow, /prepareResearchReportSummaryImageBackfillStep/)
  assert.match(workflow, /generateResearchReportSummaryImageBackfillStep/)
  assert.match(workflow, /for \(const candidate of prepared\.selected\)/)
  assert.match(workflow, /reportAnalysisAiRequests:\s*0/)
  assert.doesNotMatch(workflow, /fetchResearchReportPdf|parseResearchReportPdf|analyzeResearchReportPages/)

  assert.match(steps, /generateResearchReportSummaryImage\(/)
  assert.match(steps, /summary_image_analysis_id/)
  assert.match(steps, /analysis_status", "ready"/)
  assert.doesNotMatch(steps, /discoverTopiReports|fetchResearchReportPdf|parseResearchReportPdf|analyzeResearchReportPages/)

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /start\(researchReportSummaryImageBackfillWorkflow/)
  assert.match(route, /maxReports/)
  assert.match(route, /runtime\s*=\s*"nodejs"/)
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/)
})
