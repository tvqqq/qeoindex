import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildResearchReportSummaryImageFields } from "../../modules/research-reports/summary-image.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("research summary image prompt is grounded in persisted report analysis and makes related tickers explicit", () => {
  const fields = buildResearchReportSummaryImageFields({
    report: {
      title: "Ngành Cao su & Săm lốp: Chu kỳ giá thuận lợi",
      source_name: "KAFI",
      publish_date: "2026-09-21",
      sector_name: "Cao su & Săm lốp",
      recommendation: "KHÁC",
    },
    analysis: {
      executive_summary: "Nguồn cung cao su thắt chặt trong khi nhu cầu lốp xe tăng.",
      key_points: ["Chu kỳ giá cao su thuận lợi", "Chuyển đổi quỹ đất là động lực định giá"],
      catalysts: ["Nhu cầu EV tăng"],
      risks: ["Biến động giá hàng hóa"],
    },
    mentions: [
      { ticker: "GVR", stance: "positive", recommendation_text: "TÍCH CỰC" },
      { ticker: "DRC", stance: "positive", recommendation_text: "MUA" },
    ],
  })

  assert.equal(fields.location, "Vietnam Equity Research Report")
  assert.match(fields.headline, /Cao su/)
  assert.match(fields.services, /GVR/)
  assert.match(fields.services, /DRC/)
  assert.match(fields.services, /RỦI RO/)
  assert.match(fields.visuals, /Làm nổi bật rõ các mã cổ phiếu: GVR, DRC/)
  assert.match(fields.visuals, /Metadata công ty chứng khoán, ngày báo cáo và khuyến nghị đặt nhỏ/)
  assert.doesNotMatch(Object.values(fields).join("\n"), /QeoIndex/i)
})

test("image creator request keeps the required nonce, landscape size, and avoids product branding in the outgoing payload", () => {
  const code = source("modules/research-reports/summary-image.ts")

  assert.match(code, /DEFAULT_IMAGE_CREATOR_NONCE = ["']05f3482112["']/)
  assert.match(code, /body\.set\(["']wpaiic_nonce["'], DEFAULT_IMAGE_CREATOR_NONCE\)/)
  assert.match(code, /IMAGE_SIZE = ["']1536x1024["']/)
  assert.match(code, /body\.set\(["']size_choice["'], IMAGE_SIZE\)/)
  assert.doesNotMatch(code, /QeoIndexResearch/)
})

test("summary image persistence is content-hash aware and isolated from canonical report analysis status", () => {
  const code = source("modules/research-reports/summary-image.ts")
  const migration = source("supabase/migrations/20260923165000_qeo272_research_report_summary_images.sql")

  assert.match(code, /summary_image_content_hash/)
  assert.match(code, /existingHash === input\.contentHash/)
  assert.match(code, /summary_image_status: "failed"/)
  assert.match(migration, /summary_image_status/)
  assert.match(migration, /summary_image_content_hash/)
  assert.match(migration, /Failure never invalidates canonical report analysis/)
})
