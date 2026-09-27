import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

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

test("QEO-286 detail keeps the image section visible and exposes controls only to root admin", () => {
  const page = source("app/research/reports/[id]/page.tsx")
  const shell = source("components/research-reports/report-detail-shell.tsx")
  const admin = source("components/research-reports/report-summary-image-admin.tsx")

  assert.match(page, /isConfiguredRootUserId\(auth\.user\.id\)/)
  assert.match(page, /canManageSummaryImage=/)
  assert.match(shell, /summaryImageUrl \|\| report\.analysis/)
  assert.match(shell, /ReportSummaryImageAdmin/)
  assert.match(shell, /report\.analysis\?\.executiveSummary/)
  assert.match(admin, /Visual guidance/)
  assert.match(admin, /Style/)
  assert.match(admin, /Model/)
  assert.match(admin, /Quality/)
  assert.match(admin, /Width/)
  assert.match(admin, /Height/)
})

test("QEO-286 regenerate API is root-only, same-origin, bounded, and force-regenerates current analysis", () => {
  const route = source("app/api/admin/research-reports/[id]/summary-image/route.ts")
  const generator = source("modules/research-reports/summary-image.ts")

  assert.match(route, /requireApiRoot/)
  assert.match(route, /validateAdminMutationRequest/)
  assert.match(route, /maxDuration = 300/)
  assert.match(route, /private, no-store, no-cache/)
  assert.match(route, /normalizeResearchReportSummaryImageSettings/)
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
