import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildResearchReportAdminDiagnostic,
} from "../../modules/research-reports/admin-analysis.ts"
import {
  DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS,
  normalizeResearchReportSummaryImageSettings,
} from "../../modules/research-reports/summary-image-settings.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-286 image generation settings are bounded and keep landscape A4 defaults", () => {
  assert.deepEqual(
    normalizeResearchReportSummaryImageSettings(undefined),
    DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS,
  )

  const custom = normalizeResearchReportSummaryImageSettings({
    visualGuidance: "  ưu tiên nhà máy   và chuỗi cung ứng ",
    style: "clean editorial",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    width: 1600,
    height: 1100,
  })

  assert.equal(custom.visualGuidance, "ưu tiên nhà máy và chuỗi cung ứng")
  assert.equal(custom.style, "clean editorial")
  assert.equal(custom.quality, "high")
  assert.equal(custom.width, 1600)
  assert.equal(custom.height, 1100)

  assert.throws(
    () => normalizeResearchReportSummaryImageSettings({ quality: "ultra" }),
    /quality must be/i,
  )
  assert.throws(
    () => normalizeResearchReportSummaryImageSettings({ width: 4096 }),
    /width must be an integer from 512 to 2048/i,
  )
  assert.throws(
    () => normalizeResearchReportSummaryImageSettings({ model: "model with spaces" }),
    /unsupported characters/i,
  )
})

test("QEO-286 catalog renders persisted AI executive summary when image is unavailable", () => {
  const page = source("app/reports/page.tsx")

  assert.match(page, /item\.analysisStatus === "ready" && item\.description/)
  assert.match(page, /AI SUMMARY/)
  assert.match(page, /\{item\.description\}/)
  assert.match(page, /Ảnh AI chưa tạo được — đang hiển thị tóm tắt text/)
})

test("QEO-287 detail consolidates image actions into the existing AI Summary card", () => {
  const page = source("app/research/reports/[id]/page.tsx")
  const shell = source("components/research-reports/report-detail-shell.tsx")
  const analysis = source("components/research-reports/analysis-panel.tsx")
  const admin = source("components/research-reports/report-summary-image-admin.tsx")

  assert.match(page, /isConfiguredRootUserId\(auth\.user\.id\)/)
  assert.match(page, /canManageReportAi=/)
  assert.doesNotMatch(shell, /AI VISUAL SUMMARY/)
  assert.doesNotMatch(shell, /ReportSummaryImageAdmin/)
  assert.match(shell, /summaryImageUrl=\{summaryImageUrl\}/)
  assert.match(shell, /summaryImageStatus=\{report\.summaryImageStatus\}/)
  assert.match(shell, /canManageReportAi=\{canManageReportAi\}/)

  assert.match(analysis, /AI SUMMARY/)
  assert.match(analysis, />Tóm tắt AI</)
  assert.match(analysis, /ReportSummaryImageAdmin/)
  assert.match(analysis, /ReportSummaryImage/)
  assert.match(analysis, /summaryImageStatus === "failed"/)

  assert.match(admin, /Visual guidance/)
  assert.match(admin, /Style/)
  assert.match(admin, /Model/)
  assert.match(admin, /Quality/)
  assert.match(admin, /Width/)
  assert.match(admin, /Height/)
  assert.match(admin, /lỗi upstream, không phải do nội dung params/i)
})

test("QEO-287 regenerate image API stays root-only and avoids the broad Research Reports barrel", () => {
  const route = source("app/api/admin/research-reports/[id]/summary-image/route.ts")
  const generator = source("modules/research-reports/summary-image.ts")

  assert.match(route, /requireApiRoot/)
  assert.match(route, /validateAdminMutationRequest/)
  assert.match(route, /maxDuration = 300/)
  assert.match(route, /private, no-store, no-cache/)
  assert.match(route, /normalizeResearchReportSummaryImageSettings/)
  assert.match(route, /@\/modules\/research-reports\/detail\/service/)
  assert.doesNotMatch(route, /from "@\/modules\/research-reports"/)
  assert.match(route, /analysisStatus !== "ready"/)
  assert.match(route, /force: true/)
  assert.match(generator, /settings\.visualGuidance/)
  assert.match(generator, /fields\.style = settings\.style/)
  assert.match(generator, /settings\.quality/)
  assert.match(generator, /settings\.width/)
  assert.match(generator, /settings\.height/)
  assert.match(generator, /settings\.model/)
  assert.match(generator, /preserveExistingImage/)
  assert.match(generator, /summary_image_error: detail/)
})

test("QEO-287 admin analysis diagnostic sanitizes errors and blocks only active or source-less retries", () => {
  const failed = buildResearchReportAdminDiagnostic({
    analysis_status: "failed",
    analysis_error: "Bearer secret-token OpenAI Responses remained incomplete after bounded retry",
    ingestion_status: "parsed",
    ingestion_error: null,
    pdf_url: "https://cdn.example/report.pdf",
  })
  assert.equal(failed.retryable, true)
  assert.match(failed.analysisError || "", /Bearer \[REDACTED\]/)
  assert.doesNotMatch(failed.analysisError || "", /secret-token/)

  const needsOcr = buildResearchReportAdminDiagnostic({
    analysis_status: "needs_ocr",
    ingestion_status: "needs_ocr",
    pdf_url: "https://cdn.example/report.pdf",
  })
  assert.equal(needsOcr.retryable, true)
  assert.equal(needsOcr.retryBlockedReason, null)

  const processing = buildResearchReportAdminDiagnostic({
    analysis_status: "processing",
    ingestion_status: "parsed",
    pdf_url: "https://cdn.example/report.pdf",
  })
  assert.equal(processing.retryable, false)
  assert.match(processing.retryBlockedReason || "", /đang chạy/i)

  const missingPdf = buildResearchReportAdminDiagnostic({
    analysis_status: "failed",
    ingestion_status: "failed",
    pdf_url: null,
  })
  assert.equal(missingPdf.retryable, false)
  assert.match(missingPdf.retryBlockedReason || "", /PDF HTTPS/i)
})

test("QEO-287 root admin can inspect and retry unavailable report analysis through the canonical pipeline", () => {
  const route = source("app/api/admin/research-reports/[id]/analysis/route.ts")
  const dialog = source("components/research-reports/report-analysis-admin.tsx")
  const analysis = source("components/research-reports/analysis-panel.tsx")

  assert.match(route, /export async function GET/)
  assert.match(route, /export async function POST/)
  assert.match(route, /requireApiRoot/)
  assert.match(route, /validateAdminMutationRequest/)
  assert.match(route, /private, no-store, no-cache/)
  assert.match(route, /maxDuration = 300/)
  assert.match(route, /createResearchReportAiBudget/)
  assert.match(route, /MAX_AI_REQUEST_ATTEMPTS = 4/)
  assert.match(route, /maxEstimatedCostUsd: MAX_AI_COST_USD/)
  assert.match(route, /processResearchReport/)
  assert.match(route, /analysis_status,analysis_error,ingestion_status,ingestion_error/)
  assert.doesNotMatch(route, /analysis_error[^\n]*NextResponse/)

  assert.match(dialog, /Xem lỗi & phân tích lại/)
  assert.match(dialog, /Phân tích AI lại/)
  assert.match(dialog, /Analysis error/)
  assert.match(dialog, /PDF \/ ingestion error/)
  assert.match(dialog, /method: "POST"/)
  assert.match(analysis, /ReportAnalysisAdmin/)
})
